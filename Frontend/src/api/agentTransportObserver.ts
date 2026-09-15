import type { EventEnvelope, WsRequest } from "./eventTypes";

export type AgentTransportDirection = "inbound" | "outbound" | "system";
export type AgentTransportObservationStage = "wire" | "projected" | "command" | "lifecycle" | "malformed";

export interface AgentTransportCorrelation {
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly commandId?: string;
  readonly resourceId?: string;
}

interface AgentTransportObservationBase {
  readonly connectionId: string;
  readonly observedAt: string;
  readonly direction: AgentTransportDirection;
  readonly stage: AgentTransportObservationStage;
  readonly byteLength?: number;
}

export type AgentTransportObservation =
  | (AgentTransportObservationBase & {
      readonly direction: "inbound";
      readonly stage: "wire";
    })
  | (AgentTransportObservationBase & {
      readonly direction: "inbound";
      readonly stage: "projected";
      readonly envelope: EventEnvelope;
    })
  | (AgentTransportObservationBase & {
      readonly direction: "outbound";
      readonly stage: "command";
      readonly requestType: WsRequest["type"];
      readonly correlation: AgentTransportCorrelation;
    })
  | (AgentTransportObservationBase & {
      readonly direction: "system";
      readonly stage: "lifecycle";
      readonly state: "connecting" | "open" | "error" | "closed" | "retry_scheduled";
      readonly attempt?: number;
      readonly delayMs?: number;
      readonly code?: number;
      readonly reason?: string;
      readonly wasClean?: boolean;
    })
  | (AgentTransportObservationBase & {
      readonly direction: "system";
      readonly stage: "malformed";
      readonly message: string;
    });

export type AgentTransportObservationSink = (observations: readonly AgentTransportObservation[]) => void;

const sinks = new Set<AgentTransportObservationSink>();
let nextConnectionSequence = 1;
const encoder = new TextEncoder();

export function createAgentTransportConnectionId(): string {
  const id = `ws-${nextConnectionSequence}`;
  nextConnectionSequence += 1;
  return id;
}

export function subscribeAgentTransportObservations(sink: AgentTransportObservationSink): () => void {
  sinks.add(sink);
  return () => sinks.delete(sink);
}

export function publishAgentTransportObservation(observation: AgentTransportObservation): void {
  publishAgentTransportObservations([observation]);
}

export function publishAgentTransportObservations(observations: readonly AgentTransportObservation[]): void {
  if (observations.length === 0) return;
  for (const sink of sinks) {
    try {
      sink(observations);
    } catch {
      // Observability must never interrupt WebSocket delivery.
    }
  }
}

export function observeOutboundAgentRequest(
  connectionId: string,
  request: WsRequest,
  serialized: string,
): AgentTransportObservation {
  return {
    connectionId,
    observedAt: new Date().toISOString(),
    direction: "outbound",
    stage: "command",
    requestType: request.type,
    correlation: projectRequestCorrelation(request),
    byteLength: readUtf8ByteLength(serialized),
  };
}

export function readTransportFrameByteLength(data: unknown): number | undefined {
  if (typeof data === "string") return readUtf8ByteLength(data);
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.size;
  return undefined;
}

export function describeTransportError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 240);
}

function readUtf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function projectRequestCorrelation(request: WsRequest): AgentTransportCorrelation {
  const record = request as WsRequest & Partial<Record<keyof AgentTransportCorrelation, unknown>>;
  return Object.fromEntries(
    CorrelationFields.flatMap((field) => {
      const value = record[field];
      return typeof value === "string" && value.length > 0 ? [[field, value] as const] : [];
    }),
  );
}

const CorrelationFields = ["sessionId", "requestId", "commandId", "resourceId"] as const;
