import type { AgentModelUsageValue } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentRunContextMode } from "./AgentRunDispatchPort.js";
import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentSystemPromptLayer } from "./AgentRunDispatchPort.js";
import type { AgentSubagentCapabilityCeiling } from "./AgentSubagentContracts.js";

export const AgentChildRunStatuses = {
  Queued: "queued",
  Running: "running",
  WrappingUp: "wrapping_up",
  Cancelling: "cancelling",
  AwaitingSupervisor: "awaiting_supervisor",
  Completed: "completed",
  PartialCompleted: "partial_completed",
  Interrupted: "interrupted",
  TimedOut: "timed_out",
  Failed: "failed",
  Cancelled: "cancelled",
} as const;

export type AgentChildRunStatus = (typeof AgentChildRunStatuses)[keyof typeof AgentChildRunStatuses];

export const AgentChildRunResultKinds = {
  Text: "text",
} as const;

export type AgentChildRunResultKind = (typeof AgentChildRunResultKinds)[keyof typeof AgentChildRunResultKinds];

export const AgentChildRunModelSelectionSources = {
  Request: "request",
  ExtensionDefault: "extension_default",
  Role: "role",
  Parent: "parent",
  RuntimeDefault: "runtime_default",
} as const;

export type AgentChildRunModelSelectionSource =
  (typeof AgentChildRunModelSelectionSources)[keyof typeof AgentChildRunModelSelectionSources];

export const AgentChildWorkspaceAccessModes = {
  ReadOnly: "read_only",
  ReadWrite: "read_write",
} as const;

export type AgentChildWorkspaceAccessMode =
  (typeof AgentChildWorkspaceAccessModes)[keyof typeof AgentChildWorkspaceAccessModes];

export interface AgentChildRunSelectedSkill {
  readonly name: string;
  readonly revision: string;
}

export interface AgentChildRunActivityExtensionPolicy {
  readonly recentActivityWindowMs: number;
  readonly stepMs: number;
  readonly maximumMs: number;
}

export interface AgentChildRunDeadlinePolicy {
  readonly softTimeoutMs: number;
  readonly wrapUpTimeoutMs: number;
  readonly activityExtension: AgentChildRunActivityExtensionPolicy;
  readonly snapshotIntervalMs: number;
}

export interface AgentChildRunExecutionContract {
  readonly version: 5;
  readonly workspaceAccess: AgentChildWorkspaceAccessMode;
  readonly promptLayer: AgentSystemPromptLayer;
  readonly modelCandidateProviderIds: readonly string[];
  readonly thinkingLevel?: ModelThinkingLevel;
  readonly inheritProjectContext: boolean;
  readonly capabilityCeiling?: AgentSubagentCapabilityCeiling;
  readonly deadline: AgentChildRunDeadlinePolicy;
}

export interface AgentChildRunSnapshot {
  readonly version: 1;
  readonly capturedAt: string;
  readonly lastActivityAt: string;
  readonly lastModelOutputAt?: string;
  readonly modelOutputCharacters: number;
  readonly assistantTurns: number;
  readonly toolCalls: {
    readonly planned: number;
    readonly started: number;
    readonly completed: number;
    readonly failed: number;
  };
  readonly activeTools: readonly string[];
  readonly artifactUris: readonly string[];
  readonly deadline: {
    readonly softDeadlineAt: string;
    readonly grantedExtensionMs: number;
    readonly hardDeadlineAt?: string;
  };
}

export const AgentChildRunProgressPhases = {
  Queued: "queued",
  Starting: "starting",
  ModelOutput: "model_output",
  ToolExecution: "tool_execution",
  AwaitingSupervisor: "awaiting_supervisor",
  WrappingUp: "wrapping_up",
  Cancelling: "cancelling",
  Completed: "completed",
  Failed: "failed",
  Cancelled: "cancelled",
} as const;

export type AgentChildRunProgressPhase = (typeof AgentChildRunProgressPhases)[keyof typeof AgentChildRunProgressPhases];

/** Model-facing progress projection. It is intentionally smaller than the persisted runtime snapshot. */
export interface AgentChildRunProgressProjection {
  readonly phase: AgentChildRunProgressPhase;
  readonly lastActivityAt?: string;
  readonly activeTools: readonly string[];
  readonly toolCalls: {
    readonly planned: number;
    readonly started: number;
    readonly completed: number;
    readonly failed: number;
  };
  readonly checkpointAvailable: boolean;
  readonly artifactCount: number;
}

export const AgentChildRunCheckpointSources = {
  ModelStream: "model_stream",
  AssistantMessage: "assistant_message",
  SupervisorWait: "supervisor_wait",
} as const;

export type AgentChildRunCheckpointSource =
  (typeof AgentChildRunCheckpointSources)[keyof typeof AgentChildRunCheckpointSources];

export interface AgentChildRunCheckpoint {
  readonly version: 1;
  readonly capturedAt: string;
  readonly source: AgentChildRunCheckpointSource;
  readonly content?: string;
  readonly complete: boolean;
}

export const AgentChildRunMessageDirections = {
  ChildToParent: "child_to_parent",
  ParentToChild: "parent_to_child",
} as const;

export type AgentChildRunMessageDirection =
  (typeof AgentChildRunMessageDirections)[keyof typeof AgentChildRunMessageDirections];

export const AgentChildRunMessageKinds = {
  Decision: "decision",
  FollowUp: "follow_up",
  Progress: "progress",
  Response: "response",
  Steering: "steering",
} as const;

export type AgentChildRunMessageKind = (typeof AgentChildRunMessageKinds)[keyof typeof AgentChildRunMessageKinds];

export interface AgentChildRunMessage {
  readonly id: string;
  readonly childRunId: string;
  readonly direction: AgentChildRunMessageDirection;
  readonly kind: AgentChildRunMessageKind;
  readonly content: string;
  readonly createdAt: string;
}

export interface AgentChildRunRecord {
  readonly id: string;
  /** Stable workflow identity shared by related child nodes. */
  readonly ownerRunId: string;
  /** Stable logical node identity across retries. */
  readonly nodeId: string;
  readonly parentSessionId: string;
  readonly parentRequestId: string;
  readonly childSessionId: string;
  readonly childRequestId: string;
  readonly agentName: string;
  readonly task: string;
  readonly contextMode: AgentRunContextMode;
  readonly approvalMode: AgentExecutionApprovalMode;
  readonly modelProviderId?: string;
  readonly modelSelectionSource?: AgentChildRunModelSelectionSource;
  readonly selectedSkills: readonly AgentChildRunSelectedSkill[];
  readonly configurationRevision?: number;
  readonly status: AgentChildRunStatus;
  readonly launchContractDigest: string;
  readonly launchContract: Readonly<Record<string, unknown>>;
  readonly allowedToolNames: readonly string[];
  readonly executionContract: AgentChildRunExecutionContract;
  readonly messages: readonly AgentChildRunMessage[];
  readonly snapshot?: AgentChildRunSnapshot;
  readonly checkpoint?: AgentChildRunCheckpoint;
  readonly finalAnswer?: string;
  readonly usage?: AgentModelUsageValue;
  readonly error?: string;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly updatedAt: string;
  readonly revision: number;
}

export type AgentChildRunCreateInput = Omit<
  AgentChildRunRecord,
  | "ownerRunId"
  | "nodeId"
  | "status"
  | "messages"
  | "snapshot"
  | "checkpoint"
  | "finalAnswer"
  | "usage"
  | "error"
  | "createdAt"
  | "startedAt"
  | "completedAt"
  | "updatedAt"
  | "revision"
> & {
  readonly ownerRunId?: string;
  readonly nodeId?: string;
};

export interface AgentChildRunCompletionInput {
  readonly finalAnswer: string;
  readonly usage?: AgentModelUsageValue;
}

export interface AgentChildRunRepository {
  create(input: AgentChildRunCreateInput, createdAt?: string): AgentChildRunRecord;
  get(id: string): AgentChildRunRecord | undefined;
  getByChildSession(childSessionId: string): AgentChildRunRecord | undefined;
  listForParent(parentSessionId: string, parentRequestId?: string): AgentChildRunRecord[];
  listForOwner(ownerRunId: string): AgentChildRunRecord[];
  getByOwnerNode(ownerRunId: string, nodeId: string): AgentChildRunRecord | undefined;
  listActive(): AgentChildRunRecord[];
  listAll(): AgentChildRunRecord[];
  markRunning(id: string, startedAt?: string): AgentChildRunRecord | undefined;
  markWrappingUp(id: string, updatedAt?: string): AgentChildRunRecord | undefined;
  markCancelling(id: string, updatedAt?: string): AgentChildRunRecord | undefined;
  markAwaitingSupervisor(id: string, updatedAt?: string): AgentChildRunRecord | undefined;
  markResumed(id: string, childRequestId: string, updatedAt?: string): AgentChildRunRecord | undefined;
  recordSnapshot(
    id: string,
    snapshot: AgentChildRunSnapshot,
    checkpoint?: AgentChildRunCheckpoint,
    updatedAt?: string,
  ): AgentChildRunRecord | undefined;
  recordSupervisorCheckpoint(
    id: string,
    result: { readonly finalAnswer: string; readonly usage?: AgentModelUsageValue },
    updatedAt?: string,
  ): AgentChildRunRecord | undefined;
  appendMessage(message: Omit<AgentChildRunMessage, "createdAt">, createdAt?: string): AgentChildRunMessage;
  markCompleted(
    id: string,
    result: AgentChildRunCompletionInput,
    completedAt?: string,
  ): AgentChildRunRecord | undefined;
  markPartialCompleted(
    id: string,
    result: AgentChildRunCompletionInput,
    completedAt?: string,
  ): AgentChildRunRecord | undefined;
  markInterrupted(
    id: string,
    error: string,
    completedAt?: string,
    partialAnswer?: string,
  ): AgentChildRunRecord | undefined;
  markFailed(id: string, error: string, completedAt?: string): AgentChildRunRecord | undefined;
  markCancelled(id: string, completedAt?: string, partialAnswer?: string): AgentChildRunRecord | undefined;
  markTimedOut(
    id: string,
    error: string,
    completedAt?: string,
    partialAnswer?: string,
  ): AgentChildRunRecord | undefined;
  recoverInterrupted(error: string, recoveredAt?: string): number;
}
