import type { AgentPiToolPlanState } from "../PiShared/AgentPiPlanningTypes.js";

export const AgentExecutionStatuses = {
  Active: "active",
  Paused: "paused",
  Blocked: "blocked",
  Completed: "completed",
  Cancelled: "cancelled",
} as const;

export type AgentExecutionStatus = (typeof AgentExecutionStatuses)[keyof typeof AgentExecutionStatuses];

export const AgentExecutionStepStatuses = {
  Planned: "planned",
  Running: "running",
  Completed: "completed",
  Failed: "failed",
  Blocked: "blocked",
} as const;

export type AgentExecutionStepStatus = (typeof AgentExecutionStepStatuses)[keyof typeof AgentExecutionStepStatuses];

export const AgentExecutionEventKinds = {
  Created: "execution.created",
  StepStarted: "execution.step.started",
  StepCompleted: "execution.step.completed",
  Blocked: "execution.blocked",
  Completed: "execution.completed",
} as const;

export type AgentExecutionEventKind = (typeof AgentExecutionEventKinds)[keyof typeof AgentExecutionEventKinds];

export interface AgentExecutionStep {
  readonly id: string;
  readonly nodeId: string;
  readonly planId: string;
  readonly planRevision: number;
  readonly index: number;
  readonly title: string;
  readonly detail: string;
  readonly status: AgentExecutionStepStatus;
  readonly dependencyIds: readonly string[];
  readonly callId?: string;
  readonly failure?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentExecutionLedger {
  readonly id: string;
  readonly uri: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly objective: string;
  readonly status: AgentExecutionStatus;
  readonly reason?: string;
  readonly steps: readonly AgentExecutionStep[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
}

export interface AgentExecutionLedgerSnapshot {
  readonly active: AgentExecutionLedger | null;
  readonly executions: readonly AgentExecutionLedger[];
}

export interface AgentExecutionPlanSyncInput {
  readonly sessionId: string;
  readonly requestId: string;
  readonly objective: string;
  readonly planState: AgentPiToolPlanState;
  readonly completion?: "immediate" | "deferred";
  readonly now?: Date;
}

export interface AgentExecutionEventRecord {
  readonly kind: AgentExecutionEventKind;
  readonly execution: AgentExecutionLedger;
  readonly step?: AgentExecutionStep;
}

export interface AgentExecutionSyncResult {
  readonly snapshot: AgentExecutionLedgerSnapshot;
  readonly events: readonly AgentExecutionEventRecord[];
}

export interface AgentExecutionPromptContext {
  readonly active: AgentExecutionLedger | null;
  readonly executions: readonly AgentExecutionLedger[];
}

export const EmptyAgentExecutionPromptContext: AgentExecutionPromptContext = {
  active: null,
  executions: [],
};
