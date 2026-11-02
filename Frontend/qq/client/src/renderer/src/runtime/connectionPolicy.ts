import { watch } from 'vue'
import { AgentWebSocketCloseCodes } from '../../../../../../../Source/AgentSystem/WebSocket/AgentWebSocketCloseContract'

export const ClientHeartbeatTimeoutCloseCode = AgentWebSocketCloseCodes.HeartbeatTimeout
export type ClientConnectionPhase = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

/** Await only transport readiness; callers own their draft and never replay an unacknowledged send. */
export function waitForClientConnection(phase: () => ClientConnectionPhase, signal?: AbortSignal, timeoutMs = 50_000): Promise<void> {
    if (signal?.aborted) return Promise.reject(new DOMException('发送已取消', 'AbortError'))
    if (phase() === 'connected') return Promise.resolve()
    if (phase() === 'disconnected') return Promise.reject(new Error('连接已断开，请重新连接后发送'))
    return new Promise((resolve, reject) => {
        const finish = (error?: Error) => {
            stop()
            clearTimeout(timer)
            signal?.removeEventListener('abort', abort)
            if (error) reject(error)
            else resolve()
        }
        const abort = () => finish(new DOMException('发送已取消', 'AbortError'))
        const stop = watch(phase, value => {
            if (value === 'connected') finish()
            else if (value === 'disconnected') finish(new Error('连接已断开，请重新连接后发送'))
        }, { flush: 'sync' })
        const timer = setTimeout(() => finish(new Error('等待连接恢复超时，内容已保留，请重试')), timeoutMs)
        signal?.addEventListener('abort', abort, { once: true })
    })
}

/** A local heartbeat timeout is recoverable; authentication and payload rejection need user action. */
export function shouldReconnectClient(code: number): boolean {
    return code !== 1000 && code !== 1008 && code !== 1009 && code <= ClientHeartbeatTimeoutCloseCode
}
