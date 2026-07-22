import { useCallback, useEffect, useRef, useState } from "react";
import { type EventEnvelope, type WsRequest } from "./eventTypes";
import {
  coalesceStreamingEvents,
  isBufferedStreamingEvent,
  StreamingEventMaxLatencyMs,
} from "./streamingEventCoalescer";

export type SocketStatus = "idle" | "connecting" | "open" | "closed" | "error";

interface UseAgentSocketBaseOptions {
  url: string;
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

export function readAgentSocketRetryDelayMs(attempt: number): number {
  return Math.min(15000, 1000 * 2 ** Math.max(0, attempt));
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
  const { url, onEvent, onEvents, onMalformedEvent } = opts;
  const [status, setStatus] = useState<SocketStatus>("idle");
  const wsRef = useRef<WebSocket | null>(null);
  const connectSeqRef = useRef(0);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const closedByUserRef = useRef(false);
  const onEventRef = useRef(onEvent);
  const onEventsRef = useRef(onEvents);
  const onMalformedEventRef = useRef(onMalformedEvent);
  onEventRef.current = onEvent;
  onEventsRef.current = onEvents;
  onMalformedEventRef.current = onMalformedEvent;

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

  const connect = useCallback((): void => {
    const connectSeq = ++connectSeqRef.current;
    closedByUserRef.current = false;
    setStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      setStatus("error");
      scheduleRetryRef.current();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      if (connectSeq !== connectSeqRef.current || wsRef.current !== ws) {
        ws.close();
        return;
      }
      retryRef.current = 0;
      setStatus("open");
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

    ws.onclose = () => {
      if (connectSeq !== connectSeqRef.current || wsRef.current !== ws) {
        return;
      }
      setStatus("closed");
      wsRef.current = null;
      if (!closedByUserRef.current) {
        scheduleRetryRef.current();
      }
    };
  }, [dispatch, url]);

  const scheduleRetry = useCallback((): void => {
    if (retryTimerRef.current !== null) return;
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
    connect();
    return () => {
      closedByUserRef.current = true;
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      clearFlushSchedule();
      connectSeqRef.current += 1;
      wsRef.current?.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const send = useCallback((req: WsRequest): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(req));
    return true;
  }, []);

  const reconnect = useCallback((): void => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    wsRef.current?.close();
    retryRef.current = 0;
    connect();
  }, [connect]);

  return { status, send, reconnect };
}
