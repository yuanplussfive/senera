import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClientConnectionLifecycle } from "./connectionLifecycle";
import { createClientWebSocket, type ClientWebSocket } from "./clientWebSocket";
import { ConnectionLiveness } from "./connectionLiveness";
import { PendingRequests } from "./pendingRequests";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import { z } from "zod/mini";
import { AgentChannelKinds } from "../../../Source/AgentSystem/Channels/AgentChannelTypes";
import { EventKinds, type EventEnvelope, type WsRequest } from "./eventTypes";
import { EventChannels, EventTransportSpecs, type EventKind } from "./generatedEventCatalog";
import {
  coalesceStreamingEvents,
  isBufferedStreamingEvent,
  StreamingEventMaxLatencyMs,
} from "./streamingEventCoalescer";
import { AgentEventIdWindow } from "./eventDeliveryIdentity";
import { readAgentTransportRetryDelayMs as readAgentSocketRetryDelayMs } from "./agentTransportRetry";
export { readAgentSocketRetryDelayMs };
import {
  createAgentTransportConnectionId,
  describeTransportError,
  observeOutboundAgentRequest,
  publishAgentTransportObservation,
  publishAgentTransportObservations,
  readTransportFrameByteLength,
} from "./agentTransportObserver";

export type SocketStatus = "idle" | "connecting" | "open" | "closed" | "error";

export interface AgentSocketDisconnect {
  readonly url: string;
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
    | { onEvent?: never; onEvents: (events: readonly EventEnvelope[], sourceUrl: string) => void }
  );

export interface AgentSocketHandle {
  status: SocketStatus;
  send: (req: WsRequest) => boolean;
  sendAccepted: (req: Extract<WsRequest, { type: "session.message" }> & { requestId: string }) => Promise<void> | false;
  reconnect: () => void;
}

const AgentSocketStableConnectionMs = 30_000;

export function parseAgentSocketEventData(data: unknown): EventEnvelope {
  const value: unknown = JSON.parse(typeof data === "string" ? data : "");
  const envelope = AgentSocketEventEnvelopeSchema.parse(value);
  if (!("data" in envelope)) throw new Error("Agent event envelope is missing data.");
  const spec = EventTransportSpecs[envelope.kind as EventKind];
  if (!spec) throw new Error(`Unknown agent event kind: ${envelope.kind}.`);
  if (envelope.layer !== spec.layer || envelope.phase !== spec.phase) {
    throw new Error(
      `Agent event ${envelope.kind} expected ${spec.layer}/${spec.phase}; received ${envelope.layer}/${envelope.phase}.`,
    );
  }
  return envelope as EventEnvelope;
}

const AgentSocketNonBlankStringSchema = z.string().check(z.minLength(1));
const AgentSocketNonNegativeIntegerSchema = z.int().check(z.nonnegative());

const AgentSocketEventEnvelopeSchema = z.looseObject({
  eventId: z.optional(AgentSocketNonBlankStringSchema),
  channel: z.literal(EventChannels.AgentEvent),
  kind: AgentSocketNonBlankStringSchema,
  layer: AgentSocketNonBlankStringSchema,
  phase: AgentSocketNonBlankStringSchema,
  sequence: AgentSocketNonNegativeIntegerSchema,
  timestamp: z.iso.datetime({ offset: true }),
  sessionId: z.optional(AgentSocketNonBlankStringSchema),
  requestId: z.optional(AgentSocketNonBlankStringSchema),
  step: z.optional(AgentSocketNonNegativeIntegerSchema),
  scope: z.optional(
    z.looseObject({
      parentRequestId: z.optional(AgentSocketNonBlankStringSchema),
      channel: z.optional(z.enum({ Console: "console", ...AgentChannelKinds })),
      workflowName: z.optional(AgentSocketNonBlankStringSchema),
      jobId: z.optional(AgentSocketNonBlankStringSchema),
      agentName: z.optional(AgentSocketNonBlankStringSchema),
      role: z.optional(z.enum(["childAgent", "merge"])),
    }),
  ),
  detailId: z.optional(AgentSocketNonBlankStringSchema),
  data: z.unknown(),
});

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
  const wsRef = useRef<ClientWebSocket | null>(null);
  const acceptance = useMemo(
    () => new PendingRequests<void>(() => new Error(frontendMessage("chat.sendUnconfirmed"))),
    [],
  );
  const resetConnection = useCallback(() => {
    acceptance.rejectAll(new Error(frontendMessage("chat.sendUnconfirmed")));
  }, [acceptance]);
  const pausedRef = useRef(document.visibilityState === "hidden");
  const probeRef = useRef<
    { resolve: () => void; reject: () => void; timer: ReturnType<typeof setTimeout> } | undefined
  >(undefined);
  const finishProbe = useCallback((healthy: boolean): void => {
    const probe = probeRef.current;
    if (!probe) return;
    probeRef.current = undefined;
    clearTimeout(probe.timer);
    if (healthy) probe.resolve();
    else probe.reject();
  }, []);
  const liveness = useMemo(
    () =>
      new ConnectionLiveness(
        (timeout) =>
          new Promise<void>((resolve, reject) => {
            const socket = wsRef.current;
            if (socket?.readyState !== WebSocket.OPEN) {
              reject();
              return;
            }
            probeRef.current = { resolve, reject, timer: setTimeout(() => finishProbe(false), timeout) };
            socket.send(JSON.stringify({ type: "profile.get" }));
          }),
        () => wsRef.current?.close(4000, "Connection probe timed out"),
        false,
      ),
    [finishProbe],
  );
  const connectSeqRef = useRef(0);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const stableTimerRef = useRef<number | null>(null);
  const reconnectPolicySeqRef = useRef<number | null>(null);
  const closedByUserRef = useRef(false);
  const reconnectStoppedRef = useRef(false);
  const enabledRef = useRef(enabled);
  const onEventRef = useRef(onEvent);
  const onEventsRef = useRef(onEvents);
  const onMalformedEventRef = useRef(onMalformedEvent);
  const reconnectPolicyRef = useRef(reconnectPolicy);
  const connectionIdRef = useRef(createAgentTransportConnectionId());
  const urlRef = useRef(url);
  const connectionUrlRef = useRef(url);
  urlRef.current = url;
  enabledRef.current = enabled;
  onEventRef.current = onEvent;
  onEventsRef.current = onEvents;
  onMalformedEventRef.current = onMalformedEvent;
  reconnectPolicyRef.current = reconnectPolicy;

  // rAF 批量队列
  const pendingRef = useRef<EventEnvelope[]>([]);
  const eventIdsRef = useRef(new AgentEventIdWindow());
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
    publishAgentTransportObservations(
      events.map((envelope) => ({
        connectionId: connectionIdRef.current,
        observedAt: new Date().toISOString(),
        direction: "inbound" as const,
        stage: "projected" as const,
        envelope,
      })),
    );
    const batchConsumer = onEventsRef.current;
    if (batchConsumer) {
      try {
        batchConsumer(events, connectionUrlRef.current);
      } catch (error) {
        reportMalformedEvent(onMalformedEventRef.current, error);
      }
      return;
    }
    const eventConsumer = onEventRef.current;
    for (const env of events) {
      try {
        eventConsumer?.(env);
      } catch (error) {
        reportMalformedEvent(onMalformedEventRef.current, error);
      }
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
      if (!eventIdsRef.current.accept(env)) return;
      if (isImmediateAgentControlEvent(env.kind)) {
        if (pendingRef.current.length > 0) flush();
        const batchConsumer = onEventsRef.current;
        if (batchConsumer) {
          try {
            publishAgentTransportObservation({
              connectionId: connectionIdRef.current,
              observedAt: new Date().toISOString(),
              direction: "inbound",
              stage: "projected",
              envelope: env,
            });
            batchConsumer([env], connectionUrlRef.current);
          } catch (error) {
            reportMalformedEvent(onMalformedEventRef.current, error);
          }
          return;
        }
        try {
          publishAgentTransportObservation({
            connectionId: connectionIdRef.current,
            observedAt: new Date().toISOString(),
            direction: "inbound",
            stage: "projected",
            envelope: env,
          });
          onEventRef.current?.(env);
        } catch (error) {
          reportMalformedEvent(onMalformedEventRef.current, error);
        }
        return;
      }
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
      try {
        publishAgentTransportObservation({
          connectionId: connectionIdRef.current,
          observedAt: new Date().toISOString(),
          direction: "inbound",
          stage: "projected",
          envelope: env,
        });
        onEventRef.current?.(env);
      } catch (error) {
        reportMalformedEvent(onMalformedEventRef.current, error);
      }
    },
    [flush, scheduleFlush],
  );

  const scheduleRetryRef = useRef<() => void>(() => undefined);
  const requestReconnect = useCallback((disconnect: AgentSocketDisconnect, connectSeq: number): void => {
    const applyDecision = (decision: AgentSocketReconnectDecision): void => {
      if (!enabledRef.current || closedByUserRef.current || connectSeq !== connectSeqRef.current) {
        return;
      }
      reconnectStoppedRef.current = decision === "stop";
      if (reconnectStoppedRef.current) return;
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
    if (!enabledRef.current || reconnectStoppedRef.current || wsRef.current) return;
    const connectSeq = ++connectSeqRef.current;
    connectionUrlRef.current = url;
    closedByUserRef.current = false;
    setStatus("connecting");
    publishAgentTransportObservation({
      connectionId: connectionIdRef.current,
      observedAt: new Date().toISOString(),
      direction: "system",
      stage: "lifecycle",
      state: "connecting",
    });
    let ws: ClientWebSocket;
    try {
      ws = createClientWebSocket(url);
    } catch (error) {
      setStatus("error");
      publishAgentTransportObservation({
        connectionId: connectionIdRef.current,
        observedAt: new Date().toISOString(),
        direction: "system",
        stage: "malformed",
        message: describeTransportError(error),
      });
      requestReconnect(
        { url, code: 1006, reason: "connection_constructor_failed", wasClean: false, opened: false },
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
      liveness.start(pausedRef.current);
      setStatus("open");
      publishAgentTransportObservation({
        connectionId: connectionIdRef.current,
        observedAt: new Date().toISOString(),
        direction: "system",
        stage: "lifecycle",
        state: "open",
      });
      stableTimerRef.current = window.setTimeout(() => {
        stableTimerRef.current = null;
        retryRef.current = 0;
      }, AgentSocketStableConnectionMs);
    };

    ws.onmessage = (evt) => {
      if (connectSeq !== connectSeqRef.current || wsRef.current !== ws || urlRef.current !== url) return;
      liveness.receive();
      finishProbe(true);
      publishAgentTransportObservation({
        connectionId: connectionIdRef.current,
        observedAt: new Date().toISOString(),
        direction: "inbound",
        stage: "wire",
        byteLength: readTransportFrameByteLength(evt.data),
      });
      try {
        const env = parseAgentSocketEventData(evt.data);
        const rejectedId =
          env.kind === EventKinds.SessionBusy
            ? (env.data as { rejectedRequestId?: string }).rejectedRequestId
            : undefined;
        const requestId =
          rejectedId ??
          env.requestId ??
          (env.kind === EventKinds.SessionMessageQueued ? (env.data as { requestId: string }).requestId : undefined);
        if (requestId) {
          if (env.kind === EventKinds.RunStarted || env.kind === EventKinds.SessionMessageQueued)
            acceptance.resolve(requestId, undefined);
          else if (
            env.kind === EventKinds.RequestInvalid ||
            env.kind === EventKinds.SessionBusy ||
            env.kind === EventKinds.SessionNotFound
          )
            acceptance.reject(
              requestId,
              new Error((env.data as { message?: string }).message ?? frontendMessage("chat.sendUnconfirmed")),
            );
        }
        dispatch(env);
      } catch (error) {
        publishAgentTransportObservation({
          connectionId: connectionIdRef.current,
          observedAt: new Date().toISOString(),
          direction: "system",
          stage: "malformed",
          message: describeTransportError(error),
        });
        reportMalformedEvent(onMalformedEventRef.current, error);
      }
    };

    ws.onerror = () => {
      if (connectSeq !== connectSeqRef.current || wsRef.current !== ws) {
        return;
      }
      setStatus("error");
      publishAgentTransportObservation({
        connectionId: connectionIdRef.current,
        observedAt: new Date().toISOString(),
        direction: "system",
        stage: "lifecycle",
        state: "error",
      });
    };

    ws.onclose = (event) => {
      if (connectSeq !== connectSeqRef.current || wsRef.current !== ws) {
        return;
      }
      liveness.stop();
      finishProbe(false);
      resetConnection();
      if (stableTimerRef.current !== null) {
        clearTimeout(stableTimerRef.current);
        stableTimerRef.current = null;
      }
      setStatus("closed");
      publishAgentTransportObservation({
        connectionId: connectionIdRef.current,
        observedAt: new Date().toISOString(),
        direction: "system",
        stage: "lifecycle",
        state: "closed",
        code: event.code,
        reason: event.reason.slice(0, 120),
        wasClean: event.wasClean,
      });
      wsRef.current = null;
      if (!closedByUserRef.current) {
        requestReconnect(
          {
            url,
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
            opened,
          },
          connectSeq,
        );
      }
    };
  }, [acceptance, dispatch, finishProbe, liveness, resetConnection, requestReconnect, url]);

  const scheduleRetry = useCallback((): void => {
    if (retryTimerRef.current !== null || !enabledRef.current || pausedRef.current || navigator.onLine === false)
      return;
    const attempt = retryRef.current;
    retryRef.current = attempt + 1;
    const delay = readAgentSocketRetryDelayMs(attempt);
    publishAgentTransportObservation({
      connectionId: connectionIdRef.current,
      observedAt: new Date().toISOString(),
      direction: "system",
      stage: "lifecycle",
      state: "retry_scheduled",
      attempt: attempt + 1,
      delayMs: delay,
    });
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      connect();
    }, delay);
  }, [connect]);

  scheduleRetryRef.current = scheduleRetry;

  useEffect(() => {
    if (!enabled) {
      liveness.stop();
      finishProbe(false);
      resetConnection();
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

    eventIdsRef.current = new AgentEventIdWindow();
    reconnectStoppedRef.current = false;
    connect();
    const handleOnline = (): void => {
      if (
        !pausedRef.current &&
        !wsRef.current &&
        retryTimerRef.current === null &&
        reconnectPolicySeqRef.current === null
      )
        connect();
    };
    window.addEventListener("online", handleOnline);
    return () => {
      liveness.stop();
      finishProbe(false);
      resetConnection();
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
  }, [clearFlushSchedule, clearRetrySchedule, connect, enabled, finishProbe, liveness, resetConnection]);

  const send = useCallback((req: WsRequest): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || urlRef.current !== connectionUrlRef.current) return false;
    const serialized = JSON.stringify(req);
    try {
      ws.send(serialized);
      publishAgentTransportObservation(observeOutboundAgentRequest(connectionIdRef.current, req, serialized));
      return true;
    } catch (error) {
      publishAgentTransportObservation({
        connectionId: connectionIdRef.current,
        observedAt: new Date().toISOString(),
        direction: "system",
        stage: "malformed",
        message: describeTransportError(error),
      });
      return false;
    }
  }, []);

  const sendAccepted = useCallback(
    (req: Extract<WsRequest, { type: "session.message" }> & { requestId: string }): Promise<void> | false => {
      if (wsRef.current?.readyState !== WebSocket.OPEN || urlRef.current !== connectionUrlRef.current) return false;
      return acceptance.request(req.requestId, AgentSocketStableConnectionMs, () => {
        if (!send(req)) throw new Error(frontendMessage("chat.sendDisconnected"));
      });
    },
    [acceptance, send],
  );

  const reconnect = useCallback((): void => {
    if (!enabledRef.current) return;
    liveness.stop();
    finishProbe(false);
    resetConnection();
    clearRetrySchedule();
    connectSeqRef.current += 1;
    reconnectPolicySeqRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    retryRef.current = 0;
    reconnectStoppedRef.current = false;
    connect();
  }, [clearRetrySchedule, connect, finishProbe, liveness, resetConnection]);

  useEffect(() => {
    const lifecycle = new ClientConnectionLifecycle({
      suspend: () => {
        pausedRef.current = true;
        liveness.suspend();
        finishProbe(false);
        clearRetrySchedule();
      },
      resume: () => {
        pausedRef.current = false;
        if (!enabledRef.current || reconnectStoppedRef.current) return;
        flush();
        if (wsRef.current?.readyState === WebSocket.OPEN) liveness.resume();
        else if (!wsRef.current) connect();
      },
    });
    lifecycle.start();
    return () => {
      lifecycle.stop();
      liveness.stop();
      finishProbe(false);
    };
  }, [clearRetrySchedule, connect, finishProbe, flush, liveness]);

  return { status, send, sendAccepted, reconnect };
}

function isImmediateAgentControlEvent(kind: string): boolean {
  return (
    kind === EventKinds.RunCancellationProgress ||
    kind === EventKinds.RunCancelled ||
    kind === EventKinds.SessionBusy ||
    kind === EventKinds.WorkspaceSwitched
  );
}

function reportMalformedEvent(handler: ((error: unknown) => void) | undefined, error: unknown): void {
  try {
    handler?.(error);
  } catch {
    // Error reporting must not escape WebSocket or animation-frame callbacks.
  }
}
