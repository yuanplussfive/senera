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
  scope?: AgentEventScope;
  detailId?: string;
  data: TData;
}

export interface AgentEventScope {
  parentRequestId?: string;
  workflowName?: string;
  jobId?: string;
  agentName?: string;
  role?: "childAgent" | "merge";
}

export interface AgentEventContext {
  sessionId?: string;
  requestId?: string;
  step?: number;
  scope?: AgentEventScope;
}

export type AgentEventSpec<TKind extends AgentEventKind, TData> = {
  layer: AgentEventLayer;
  phase: AgentEventPhase;
  kind: TKind;
  data: TData;
};
