import type { ResolvedAgentArtifactsConfig } from "../Types/AgentConfigTypes.js";
import type { ToolWorkspaceCaptureResult } from "../Types/ToolRuntimeTypes.js";

export const AgentWorkspaceObserverWorkerProtocolVersion = 1 as const;

export const AgentWorkspaceObserverWorkerRequestTypes = {
  Initialize: "initialize",
  BeginBatch: "begin_batch",
  CompleteCall: "complete_call",
  SkipCall: "skip_call",
  CancelCall: "cancel_call",
  CancelPendingBatches: "cancel_pending_batches",
  OpenResourceLease: "open_resource_lease",
  BindResourceLease: "bind_resource_lease",
  CompleteLease: "complete_lease",
  CompleteResourceLease: "complete_resource_lease",
  HasResourceLease: "has_resource_lease",
  CancelLease: "cancel_lease",
  Close: "close",
} as const;

export type AgentWorkspaceObserverWorkerRequestType =
  (typeof AgentWorkspaceObserverWorkerRequestTypes)[keyof typeof AgentWorkspaceObserverWorkerRequestTypes];

export type AgentWorkspaceObserverWorkerRequestPayload =
  | {
      readonly type: "initialize";
      readonly workspaceRoot: string;
      readonly runtimeStateRoot?: string;
      readonly config: ResolvedAgentArtifactsConfig;
    }
  | {
      readonly type: "begin_batch";
      readonly batchId: string;
      readonly callIds: readonly string[];
      readonly config: ResolvedAgentArtifactsConfig;
    }
  | {
      readonly type: "complete_call";
      readonly batchId: string;
      readonly callId: string;
      readonly exactPaths: readonly string[];
      readonly config: ResolvedAgentArtifactsConfig;
    }
  | {
      readonly type: "skip_call";
      readonly batchId: string;
      readonly callId: string;
    }
  | {
      readonly type: "cancel_call";
      readonly batchId: string;
      readonly callId: string;
    }
  | {
      readonly type: "cancel_pending_batches";
    }
  | {
      readonly type: "open_resource_lease";
      readonly config: ResolvedAgentArtifactsConfig;
    }
  | {
      readonly type: "bind_resource_lease";
      readonly leaseId: string;
      readonly resourceId: string;
    }
  | {
      readonly type: "complete_lease";
      readonly leaseId: string;
      readonly config: ResolvedAgentArtifactsConfig;
    }
  | {
      readonly type: "complete_resource_lease";
      readonly resourceId: string;
      readonly config: ResolvedAgentArtifactsConfig;
    }
  | {
      readonly type: "has_resource_lease";
      readonly resourceId: string;
    }
  | {
      readonly type: "cancel_lease";
      readonly leaseId: string;
    }
  | {
      readonly type: "close";
    };

export type AgentWorkspaceObserverWorkerRequest = AgentWorkspaceObserverWorkerRequestPayload & {
  readonly protocolVersion: typeof AgentWorkspaceObserverWorkerProtocolVersion;
  readonly requestId?: string;
};

export type AgentWorkspaceObserverWorkerResponsePayload =
  | { readonly type: "ready" }
  | { readonly type: "ok" }
  | {
      readonly type: "capture";
      readonly capture?: ToolWorkspaceCaptureResult;
    }
  | {
      readonly type: "resource_lease";
      readonly leaseId: string;
    }
  | {
      readonly type: "resource_lease_state";
      readonly active: boolean;
    }
  | {
      readonly type: "failure";
      readonly error: AgentWorkspaceObserverWorkerError;
    }
  | {
      readonly type: "log";
      readonly level: "warn";
      readonly message: string;
      readonly details: Record<string, unknown>;
    };

export type AgentWorkspaceObserverWorkerResponse = AgentWorkspaceObserverWorkerResponsePayload & {
  readonly protocolVersion: typeof AgentWorkspaceObserverWorkerProtocolVersion;
  readonly requestId?: string;
};

export interface AgentWorkspaceObserverWorkerError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

export function createAgentWorkspaceObserverWorkerRequestId(sequence: number): string {
  return `workspace-observer-${sequence}`;
}
