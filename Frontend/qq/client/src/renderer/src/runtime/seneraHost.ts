// One workspace event connection serves the shell, profiles and active conversation. AGPL-3.0-only.
import { onBeforeUnmount, ref } from 'vue'
import { adoptSeneraProfile } from './seneraIdentity'
import { adoptSeneraDirectory, refreshSeneraDirectory } from './seneraDirectory'
import { seneraClientRoot } from './seneraContext'
import { AgentControlWebSocketPath } from '../../../../../../../Source/AgentSystem/WebSocket/AgentWebSocketRoutes'
import { ConnectionLiveness } from '../../../../../../src/api/connectionLiveness'
import { ClientHeartbeatTimeoutCloseCode, shouldReconnectClient } from './connectionPolicy'
import { ClientConnectionLifecycle } from '../../../../../../src/api/connectionLifecycle'
import { createClientWebSocket, type ClientWebSocket } from '../../../../../../src/api/clientWebSocket'

export const seneraHostConnected = ref(false)
export const seneraHostError = ref('')
type HostFrame = { kind: string; data?: any; sessionId?: string }
const listeners = new Set<(frame: HostFrame) => void>()
export function subscribeSeneraHost(listener: (frame: HostFrame) => void) {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export function useSeneraHost() {
    if (!seneraClientRoot()) return
    const workspaceId = document.querySelector<HTMLMetaElement>('meta[name="senera-workspace-id"]')?.content
    if (!workspaceId) throw new Error('当前页面没有 Senera 工作区上下文')
    let socket: ClientWebSocket | undefined
    let disposed = false
    const lifecycle = new ClientConnectionLifecycle({
        suspend: () => { liveness.suspend(); finishProbe(false) },
        resume: () => {
            if (socket?.readyState === WebSocket.OPEN) liveness.resume()
            else connect()
        },
    })
    let probe: { resolve: () => void; reject: () => void; timer: ReturnType<typeof setTimeout> } | undefined
    const liveness = new ConnectionLiveness(timeout => new Promise<void>((resolve, reject) => {
        if (socket?.readyState !== WebSocket.OPEN) { reject(); return }
        probe = { resolve, reject, timer: setTimeout(() => finishProbe(false), timeout) }
        socket.send(JSON.stringify({ type: 'profile.get' }))
    }), () => socket?.close(ClientHeartbeatTimeoutCloseCode, '连接探活超时'), false)
    function finishProbe(connected: boolean) {
        if (!probe) return
        clearTimeout(probe.timer)
        const pending = probe
        probe = undefined
        if (connected) pending.resolve()
        else pending.reject()
    }
    function report(reason: unknown) {
        seneraHostError.value = reason instanceof Error ? reason.message : String(reason)
    }
    function connect() {
        if (disposed || socket) return
        lifecycle.cancelRetry()
        const url = new URL(AgentControlWebSocketPath, window.location.origin)
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        url.searchParams.set('workspaceId', workspaceId!)
        const connection = createClientWebSocket(url)
        socket = connection
        connection.onopen = () => {
            if (socket !== connection) return
            liveness.start(lifecycle.paused)
            seneraHostConnected.value = true
            seneraHostError.value = ''
            lifecycle.connected()
            connection.send(JSON.stringify({ type: 'profile.get' }))
            void refreshSeneraDirectory().catch(report)
            for (const listener of listeners) listener({ kind: 'senera.connected' })
        }
        connection.onmessage = (event) => {
            if (socket !== connection) return
            finishProbe(true)
            liveness.receive()
            try {
                const frame = JSON.parse(event.data) as HostFrame
                if (frame.kind === 'profile.snapshot') adoptSeneraProfile(frame.data)
                if (frame.kind === 'agents.snapshot') {
                    adoptSeneraDirectory(frame.data)
                    void import('@renderer/function/utils/appUtil')
                        .then(({ reloadUsers }) => reloadUsers())
                        .catch(report)
                }
                for (const listener of listeners) listener(frame)
            } catch (reason) {
                report(reason)
            }
        }
        connection.onclose = event => {
            if (socket !== connection) return
            socket = undefined
            liveness.stop()
            finishProbe(false)
            seneraHostConnected.value = false
            if (disposed) return
            if (!shouldReconnectClient(event.code)) {
                disposed = true
                lifecycle.stop()
                seneraHostError.value = `控制台连接已断开 (${event.code}: ${event.reason})`
                return
            }
            seneraHostError.value = '正在重新连接控制台'
            lifecycle.reconnect(connect)
        }
        connection.onerror = () => {
            if (socket !== connection) return
            seneraHostError.value = '控制台连接中断'
        }
    }
    lifecycle.start()
    connect()
    onBeforeUnmount(() => {
        disposed = true
        lifecycle.stop()
        liveness.stop()
        finishProbe(false)
        socket?.close()
        seneraHostConnected.value = false
    })
}
