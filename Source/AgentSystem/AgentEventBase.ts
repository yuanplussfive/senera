import type {
  AgentEventChannel,
  AgentEventKind,
  AgentEventLayer,
  AgentEventPhase,
} from "./AgentEventCatalog.js";

export interface AgentEventEnvelope<TKind extends string = AgentEventKind, TData = unknown> {
  channel: AgentEventChannel;
  kind: TKind;
  layer: AgentEventLayer;
  phase: AgentEventPhase;
  sequence: number;
  timestamp: string;
  sessionId?: string;
  requestId?: string;
  step?: number;
  detailId?: string;
  data: TData;
}

export interface AgentEventContext {
  sessionId?: string;
  requestId?: string;
  step?: number;
}

export type AgentEventSpec<TKind extends AgentEventKind, TData> = {
  layer: AgentEventLayer;
  phase: AgentEventPhase;
  kind: TKind;
  data: TData;
};
