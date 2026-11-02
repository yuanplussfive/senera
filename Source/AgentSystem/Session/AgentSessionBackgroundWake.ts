import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import type { AgentConversationEntryMetadata } from "../ModelEndpoints/AgentModelMetadata.js";

export interface AgentSessionBackgroundWakePayload {
  readonly requestId: string;
  readonly input: string;
  readonly approvalMode: AgentExecutionApprovalMode;
  readonly modelProviderId?: string;
  readonly metadata: NonNullable<AgentConversationEntryMetadata> & {
    readonly backgroundTask: { readonly taskId: string; readonly runId: string };
  };
  readonly childRunIds: readonly string[];
}

export interface AgentSessionBackgroundWakeRequest {
  readonly sessionId: string;
  /** Resolved only while the parent admission lock is held and no turn is active. */
  readonly resolve: () => AgentSessionBackgroundWakePayload | undefined;
  /** Commits the shared delivery state before another parent request can observe it. */
  readonly acknowledge: (payload: AgentSessionBackgroundWakePayload) => void;
  readonly onEvent?: import("../Events/AgentEvent.js").AgentEventSink;
}

export type AgentSessionBackgroundWakeOutcome = "accepted" | "delivered" | "missing";
