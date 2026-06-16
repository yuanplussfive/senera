import { useCallback, useEffect, useRef, useState } from "react";
import { type EventEnvelope, type WsRequest } from "./eventTypes";
import {
  coalesceStreamingEvents,
  isBufferedStreamingEvent,
  StreamingEventMaxLatencyMs,
} from "./streamingEventCoalescer";

export type SocketStatus = "idle" | "connecting" | "open" | "closed" | "error";

export interface UseAgentSocketOptions {
  url: string;
  onEvent: (env: EventEnvelope) => void;
}

export interface AgentSocketHandle {
  status: SocketStatus;
  send: (req: WsRequest) => boolean;
  reconnect: () => void;
}

/**
 * 单连接 + 指数退避自动重连。后端协议本身是无状态的（每次请求自带 sessionId），
 * 因此重连不需要恢复服务端状态，只需要 UI 重新订阅事件流即可。
 *
 * 流式优化：对 model.delta / decision.xml.progress 这类高频事件，
 * 累积到浏览器帧再回放给 onEvent；同时用最大等待窗口保证实时输出不会被拖到最终事件。
 */
export function useAgentSocket(opts: UseAgentSocketOptions): AgentSocketHandle {
  const { url, onEvent } = opts;
  const [status, setStatus] = useState<SocketStatus>("idle");
  const wsRef = useRef<WebSocket | null>(null);
  const connectSeqRef = useRef(0);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const closedByUserRef = useRef(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

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
    for (const env of coalesceStreamingEvents(queue)) {
      onEventRef.current(env);
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

  const dispatch = useCallback((env: EventEnvelope): void => {
    if (isBufferedStreamingEvent(env.kind)) {
      pendingRef.current.push(env);
      scheduleFlush();
      return;
    }
    // 低频事件：先 flush 任何 pending（保证顺序），再立即派发
    if (pendingRef.current.length > 0) {
      flush();
    }
    onEventRef.current(env);
  }, [flush, scheduleFlush]);

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
        const env = JSON.parse(typeof evt.data === "string" ? evt.data : "") as EventEnvelope;
        dispatch(env);
      } catch (err) {
        console.warn("[ws] bad payload", err);
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
    const delay = Math.min(15000, 1000 * 2 ** attempt);
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
