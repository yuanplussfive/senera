import type { AgentEventEnvelope } from "../Events/AgentEventBase.js";

export const AgentEventPersistenceStates = {
  Healthy: "healthy",
  Recovering: "recovering",
  Degraded: "degraded",
  Draining: "draining",
  Stopped: "stopped",
} as const;

export type AgentEventPersistenceState = (typeof AgentEventPersistenceStates)[keyof typeof AgentEventPersistenceStates];

export interface AgentRunEventWriterHealth {
  readonly state: AgentEventPersistenceState;
  readonly pendingBatches: number;
  readonly committedBatches: number;
  readonly committedEventWatermarks: Readonly<Record<string, number>>;
  readonly failedBatches: number;
  readonly restartCount: number;
  readonly lastError?: string;
}

export interface AgentRunEventWriter {
  append(events: readonly AgentEventEnvelope[]): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
  health(): AgentRunEventWriterHealth;
}
