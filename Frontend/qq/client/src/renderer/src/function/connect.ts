/*
 * @FileDescription: Senera QQ OneBot 11 transport.
 * Derived from Stapxs QQ Lite; original notices are retained in NOTICE.md. AGPL-3.0-only.
 */
import { reactive } from 'vue'
import { v4 as uuid } from 'uuid'
import { LogType, Logger, PopType, PopInfo } from './base'
import { dispatch } from './msg'
import type { BotActionElem, LoginCacheElem } from './elements/system'
import { getMsgData } from './utils/msgUtil'
import { useAuthStore } from '@renderer/state/auth'
import { useConnectionStore } from '@renderer/state/connection'
import { OneBotPendingRequests } from './utils/oneBotPendingRequests'
import { ClientHeartbeatTimeoutCloseCode, shouldReconnectClient, waitForClientConnection } from '../runtime/connectionPolicy'
import { ConnectionLiveness } from '../../../../../../src/api/connectionLiveness'
import { ClientConnectionLifecycle } from '../../../../../../src/api/connectionLifecycle'
import { createClientWebSocket, type ClientWebSocket } from '../../../../../../src/api/clientWebSocket'

const logger = new Logger()
const popInfo = new PopInfo()
export let websocket: ClientWebSocket | undefined

export class Connector {
    private static endpoint?: string
    private static forceCloseReason?: string
    private static connectTimeout?: ReturnType<typeof setTimeout>
    private static readonly requests = new OneBotPendingRequests<any>()
    private static readonly lifecycle = new ClientConnectionLifecycle({
        suspend: () => {
            clearTimeout(this.connectTimeout)
            this.liveness.suspend()
        },
        resume: () => {
            if (!this.endpoint) return
            if (login.creating) this.armConnectTimeout()
            if (websocket?.readyState === WebSocket.OPEN) this.liveness.resume()
            else if (!websocket) this.create(this.endpoint)
        },
    })
    private static readonly liveness = new ConnectionLiveness(
        timeout => this.callRawApi('get_status', {}, timeout),
        () => this.forceDisconnect('连接探活超时'),
    )

    private static armConnectTimeout() {
        clearTimeout(this.connectTimeout)
        if (this.lifecycle.paused) return
        this.connectTimeout = setTimeout(() => {
            if (login.creating) this.forceDisconnect('连接握手超时')
        }, 10_000)
    }

    static create(address: string) {
        if (websocket) return
        const url = new URL(address)
        if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new Error('OneBot 连接地址必须使用 WebSocket 协议')
        this.endpoint = url.href
        this.lifecycle.start()
        this.lifecycle.cancelRetry()
        login.creating = true
        useConnectionStore().phase = login.status ? 'reconnecting' : 'connecting'
        this.armConnectTimeout()

        const connection = createClientWebSocket(url)
        websocket = connection
        connection.onopen = () => {
            if (websocket !== connection) return
            this.liveness.start(this.lifecycle.paused)
            this.send('get_version_info', {}, 'getVersionInfo')
        }
        connection.onmessage = event => {
            if (websocket !== connection) return
            try {
                this.onmessage(event.data)
            } catch (reason) {
                logger.error(reason as Error, 'OneBot 返回无效消息')
            }
        }
        connection.onclose = event => {
            if (websocket !== connection) return
            clearTimeout(this.connectTimeout)
            const reason = this.forceCloseReason ?? event.reason
            this.forceCloseReason = undefined
            websocket = undefined
            login.creating = false
            this.requests.rejectAll(new Error(`OneBot 连接已断开 (${event.code}${reason ? ': ' + reason : ''})`))
            this.liveness.stop()
            const state = useConnectionStore()
            state.reason = `${event.code}${reason ? ': ' + reason : ''}`
            logger.add(LogType.WS, `连接断开 (${state.reason})`)
            if (this.endpoint && shouldReconnectClient(event.code)) {
                state.phase = 'reconnecting'
                this.lifecycle.reconnect(() => { if (this.endpoint) this.create(this.endpoint) })
                return
            }
            this.endpoint = undefined
            this.lifecycle.stop()
            state.phase = 'disconnected'
            login.status = false
            popInfo.add(PopType.ERR, `连接已断开：${state.reason}`, false)
        }
        // The close event owns recovery, avoiding a second retry path.
        connection.onerror = () => undefined
    }

    static authenticated() {
        clearTimeout(this.connectTimeout)
        this.lifecycle.connected()
        login.creating = false
        login.status = true
        const state = useConnectionStore()
        state.reason = ''
        state.phase = 'connected'
    }

    static waitUntilReady(signal?: AbortSignal) {
        return waitForClientConnection(() => useConnectionStore().phase, signal)
    }

    static onmessage(message: string) {
        this.liveness.receive()
        const data = JSON.parse(message)
        logger.add(LogType.WS, 'GET：', data)
        if (data.echo === undefined) dispatch(data)
        else if (typeof data.echo === 'string') {
            const echo = data.echo
            delete data.echo
            if (echo.startsWith('send_')) dispatch(data, echo.slice(5))
            else this.requests.resolve(echo, data)
        }
    }

    static close() {
        this.endpoint = undefined
        this.lifecycle.stop()
        clearTimeout(this.connectTimeout)
        this.liveness.stop()
        this.requests.rejectAll(new Error('OneBot 连接已关闭'))
        const connection = websocket
        websocket = undefined
        connection?.close(1000)
        this.forceCloseReason = undefined
        useConnectionStore().phase = 'disconnected'
        login.status = false
        login.creating = false
    }

    static forceDisconnect(reason: string) {
        this.liveness.stop()
        if (!websocket || this.forceCloseReason) return
        this.forceCloseReason = reason
        websocket.close(ClientHeartbeatTimeoutCloseCode, reason)
    }

    static recordHeartbeat(intervalSeconds: number) {
        this.liveness.receive(intervalSeconds * 1000)
    }

    /** Map protocol responses into the message renderer's existing contract. */
    static async callApi(api: string, args: { [key: string]: any }): Promise<any | undefined | null> {
        const apiMap = useAuthStore().jsonMap[api]
        if (!apiMap) return undefined
        try {
            return getMsgData(api, await this.callRawApi(apiMap.name, args), apiMap)
        } catch (error) {
            logger.error(error as Error, `API ${api} 请求失败`)
            return null
        }
    }

    static callRawApi(action: string, args: { [key: string]: any }, timeout = 50_000): Promise<any> {
        const echo = uuid()
        return this.requests.request(echo, timeout, () => this.sendRaw(action, args, echo))
    }

    /** Callback-based message handlers remain supported during renderer migration. */
    static send(name: string, value: { [key: string]: any }, echo = name) {
        this.sendRaw(name, value, 'send_' + echo)
    }

    static sendRaw(name: string, args: { [key: string]: any }, echo = name) {
        if (websocket?.readyState !== WebSocket.OPEN) throw new Error('OneBot 尚未连接，请连接成功后再发送')
        const action: BotActionElem = { action: name, params: args, echo }
        websocket.send(JSON.stringify(action))
        logger.add(LogType.WS, 'PUT：', action)
    }

    static sendRawJson(value: string) {
        const action = JSON.parse(value)
        this.sendRaw(action.action, action.params, action.echo)
    }
}

export const login: LoginCacheElem = reactive({
    status: false,
    address: '',
    creating: false,
})
