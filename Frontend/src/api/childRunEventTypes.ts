export type ChildRunStatus =
  | "queued"
  | "running"
  | "wrapping_up"
  | "cancelling"
  | "awaiting_supervisor"
  | "completed"
  | "partial_completed"
  | "interrupted"
  | "timed_out"
  | "failed"
  | "cancelled";

export interface ChildRunEventIdentityData {
  childRunId: string;
  ownerRunId: string;
  nodeId: string;
  childSessionId: string;
  agentName: string;
  status: ChildRunStatus;
}

export type ChildRunMessageDirection = "child_to_parent" | "parent_to_child";

export type ChildRunMessageKind = "decision" | "follow_up" | "progress" | "response" | "steering";

export interface ChildRunMessageCreatedData extends ChildRunEventIdentityData {
  messageId: string;
  direction: ChildRunMessageDirection;
  messageKind: ChildRunMessageKind;
  content: string;
}

export interface ChildRunLifecycleData extends ChildRunEventIdentityData {
  contextMode: "fresh" | "fork";
  modelProviderId?: string;
  error?: string;
}

export interface ChildRunSnapshotData extends ChildRunEventIdentityData {
  checkpointAvailable: boolean;
  snapshot: {
    version: 1;
    capturedAt: string;
    lastActivityAt: string;
    lastModelOutputAt?: string;
    modelOutputCharacters: number;
    assistantTurns: number;
    toolCalls: {
      planned: number;
      started: number;
      completed: number;
      failed: number;
    };
    activeTools: string[];
    artifactUris: string[];
    deadline: {
      softDeadlineAt: string;
      grantedExtensionMs: number;
      hardDeadlineAt?: string;
    };
  };
}

export interface ChildRunDeadlineExtendedData extends ChildRunEventIdentityData {
  extensionMs: number;
  grantedExtensionMs: number;
  softDeadlineAt: string;
}

export interface ChildRunWrappingUpData extends ChildRunEventIdentityData {
  hardDeadlineAt: string;
}

export interface ChildRunCancellingData extends ChildRunEventIdentityData {
  reason: "parent_cancelled" | "deadline_exhausted" | "shutdown";
}
