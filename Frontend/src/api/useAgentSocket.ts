import { useCallback, useEffect, useRef, useState } from "react";
import { type EventEnvelope, type WsRequest } from "./eventTypes";
import {
  coalesceStreamingEvents,
  isBufferedStreamingEvent,
  StreamingEventMaxLatencyMs,
} from "./streamingEventCoalescer";

export type SocketStatus = "idle" | "connecting" | "open" | "closed" | "error";

export interface AgentSocketDisconnect {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
  readonly opened: boolean;
}

export type AgentSocketReconnectDecision = "retry" | "stop";
export type AgentSocketReconnectPolicy = (
  disconnect: AgentSocketDisconnect,
) => AgentSocketReconnectDecision | Promise<AgentSocketReconnectDecision>;

interface UseAgentSocketBaseOptions {
  url: string;
  enabled?: boolean;
  reconnectPolicy?: AgentSocketReconnectPolicy;
  onMalformedEvent?: (error: unknown) => void;
}

export type UseAgentSocketOptions = UseAgentSocketBaseOptions &
  (
    | { onEvent: (env: EventEnvelope) => void; onEvents?: never }
    | { onEvent?: never; onEvents: (events: readonly EventEnvelope[]) => void }
  );

export interface AgentSocketHandle {
  status: SocketStatus;
  send: (req: WsRequest) => boolean;
  reconnect: () => void;
}

const AgentSocketStableConnectionMs = 30_000;

export function readAgentSocketRetryDelayMs(attempt: number, random = Math.random): number {
  const ceiling = Math.min(15_000, 1_000 * 2 ** Math.max(0, attempt));
  const boundedRandom = Math.min(1, Math.max(0, random()));
  return Math.round(ceiling / 2 + (ceiling / 2) * boundedRandom);
}

export function parseAgentSocketEventData(data: unknown): EventEnvelope {
  return JSON.parse(typeof data === "string" ? data : "") as EventEnvelope;
}

/**
 * 单连接 + 指数退避自动重连。后端协议本身是无状态的（每次请求自带 sessionId），
 * 因此重连不需要恢复服务端状态，只需要 UI 重新订阅事件流即可。
 *
 * 单事件消费者只合并模型增量和终端输出。批量消费者将当前帧的全部事件按协议顺序交付，
 * 让状态层在一次事务中完成投影；最大等待窗口保证后台标签页仍能及时推进。
 */
export function useAgentSocket(opts: UseAgentSocketOptions): AgentSocketHandle {
  const { url, enabled = true, reconnectPolicy, onEvent, onEvents, onMalformedEvent } = opts;
  const [status, setStatus] = useState<SocketStatus>("idle");
  const wsRef = useRef<WebSocket | null>(null);
  const connectSeqRef = useRef(0);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const stableTimerRef = useRef<number | null>(null);
  const reconnectPolicySeqRef = useRef<number | null>(null);
  const closedByUserRef = useRef(false);
  const enabledRef = useRef(enabled);
  const onEventRef = useRef(onEvent);
  const onEventsRef = useRef(onEvents);
  const onMalformedEventRef = useRef(onMalformedEvent);
  const reconnectPolicyRef = useRef(reconnectPolicy);
  enabledRef.current = enabled;
  onEventRef.current = onEvent;
  onEventsRef.current = onEvents;
  onMalformedEventRef.current = onMalformedEvent;
  reconnectPolicyRef.current = reconnectPolicy;

  // rAF 批量队列
  const pendingRef = useRef<EventEnvelope[]>([]);
  const rafIdRef = useRef<number | null>(null);
  const latencyTimerRef = useRef<number | null>(null);

  const clearFlushSchedule = useCallback((): void => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (latencyTimerRef.current !== null) {
      clearTimeout(latencyTimerRef.current);
      latencyTimerRef.current = null;
    }
  }, []);

  const clearRetrySchedule = useCallback((): void => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (stableTimerRef.current !== null) {
      clearTimeout(stableTimerRef.current);
      stableTimerRef.current = null;
    }
  }, []);

  const flush = useCallback((): void => {
    clearFlushSchedule();
    const queue = pendingRef.current;
    if (queue.length === 0) return;
    pendingRef.current = [];
    const events = coalesceStreamingEvents(queue);
    const batchConsumer = onEventsRef.current;
    if (batchConsumer) {
      batchConsumer(events);
      return;
    }
    const eventConsumer = onEventRef.current;
    for (const env of events) {
      eventConsumer?.(env);
    }
  }, [clearFlushSchedule]);

  const scheduleFlush = useCallback((): void => {
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(flush);
    }
    if (latencyTimerRef.current === null) {
      latencyTimerRef.current = window.setTimeout(flush, StreamingEventMaxLatencyMs);
    }
  }, [flush]);

  const dispatch = useCallback(
    (env: EventEnvelope): void => {
      if (onEventsRef.current) {
        pendingRef.current.push(env);
        scheduleFlush();
        return;
      }
      if (isBufferedStreamingEvent(env.kind)) {
        pendingRef.current.push(env);
        scheduleFlush();
        return;
      }
      // 低频事件：先 flush 任何 pending（保证顺序），再立即派发
      if (pendingRef.current.length > 0) {
        flush();
      }
      onEventRef.current?.(env);
    },
    [flush, scheduleFlush],
  );

  const scheduleRetryRef = useRef<() => void>(() => undefined);
  const requestReconnect = useCallback((disconnect: AgentSocketDisconnect, connectSeq: number): void => {
    const applyDecision = (decision: AgentSocketReconnectDecision): void => {
      if (
        decision !== "retry" ||
        !enabledRef.current ||
        closedByUserRef.current ||
        connectSeq !== connectSeqRef.current
      ) {
        return;
      }
      scheduleRetryRef.current();
    };

    const policy = reconnectPolicyRef.current;
    if (!policy) {
      applyDecision("retry");
      return;
    }
    try {
      reconnectPolicySeqRef.current = connectSeq;
      const settle = (decision: AgentSocketReconnectDecision): void => {
        if (reconnectPolicySeqRef.current !== connectSeq) return;
        reconnectPolicySeqRef.current = null;
        applyDecision(decision);
      };
      void Promise.resolve(policy(disconnect)).then(settle, () => settle("stop"));
    } catch {
      reconnectPolicySeqRef.current = null;
      applyDecision("stop");
    }
  }, []);

  const connect = useCallback((): void => {
    if (!enabledRef.current || wsRef.current) return;
    const connectSeq = ++connectSeqRef.current;
    closedByUserRef.current = false;
    setStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      setStatus("error");
      requestReconnect(
        { code: 1006, reason: "connection_constructor_failed", wasClean: false, opened: false },
        connectSeq,
      );
      return;
    }
    wsRef.current = ws;
    let opened = false;

    ws.onopen = () => {
      if (connectSeq !== connectSeqRef.current || wsRef.current !== ws) {
        ws.close();
        return;
      }
      opened = true;
      setStatus("open");
      stableTimerRef.current = window.setTimeout(() => {
        stableTimerRef.current = null;
        retryRef.current = 0;
      }, AgentSocketStableConnectionMs);
    };

    ws.onmessage = (evt) => {
      try {
        const env = parseAgentSocketEventData(evt.data);
        dispatch(env);
      } catch (error) {
        onMalformedEventRef.current?.(error);
      }
    };

    ws.onerror = () => {
      if (connectSeq !== connectSeqRef.current || wsRef.current !== ws) {
        return;
      }
      setStatus("error");
    };

    ws.onclose = (event) => {
      if (connectSeq !== connectSeqRef.current || wsRef.current !== ws) {
        return;
      }
      if (stableTimerRef.current !== null) {
        clearTimeout(stableTimerRef.current);
        stableTimerRef.current = null;
      }
      setStatus("closed");
      wsRef.current = null;
      if (!closedByUserRef.current) {
        requestReconnect(
          {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
            opened,
          },
          connectSeq,
        );
      }
    };
  }, [dispatch, requestReconnect, url]);

  const scheduleRetry = useCallback((): void => {
    if (retryTimerRef.current !== null || !enabledRef.current || navigator.onLine === false) return;
    const attempt = retryRef.current;
    retryRef.current = attempt + 1;
    const delay = readAgentSocketRetryDelayMs(attempt);
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      connect();
    }, delay);
  }, [connect]);

  scheduleRetryRef.current = scheduleRetry;

  useEffect(() => {
    if (!enabled) {
      closedByUserRef.current = true;
      clearRetrySchedule();
      clearFlushSchedule();
      connectSeqRef.current += 1;
      reconnectPolicySeqRef.current = null;
      wsRef.current?.close();
      wsRef.current = null;
      pendingRef.current = [];
      setStatus("idle");
      return;
    }

    connect();
    const handleOnline = (): void => {
      if (!wsRef.current && retryTimerRef.current === null && reconnectPolicySeqRef.current === null) connect();
    };
    window.addEventListener("online", handleOnline);
    return () => {
      closedByUserRef.current = true;
      window.removeEventListener("online", handleOnline);
      clearRetrySchedule();
      clearFlushSchedule();
      connectSeqRef.current += 1;
      reconnectPolicySeqRef.current = null;
      wsRef.current?.close();
      wsRef.current = null;
      pendingRef.current = [];
    };
  }, [clearFlushSchedule, clearRetrySchedule, connect, enabled]);

  const send = useCallback((req: WsRequest): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(req));
    return true;
  }, []);

  const reconnect = useCallback((): void => {
    if (!enabledRef.current) return;
    clearRetrySchedule();
    connectSeqRef.current += 1;
    reconnectPolicySeqRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    retryRef.current = 0;
    connect();
  }, [clearRetrySchedule, connect]);

  return { status, send, reconnect };
}
