import type { AgentEventContext } from "../Events/AgentEvent.js";
import { type AgentEventKinds } from "../Events/AgentEventCatalog.js";

export type SeneraExecutionDomainEvent = {
  kind: typeof AgentEventKinds.ExecutionFallbackStarted;
  context: Required<Pick<AgentEventContext, "requestId" | "step">>;
  data: {
    toolCallId?: string;
    pluginName: string;
    pluginVersion: string;
    toolName: string;
    manifestDigest: string;
    fromBackend: string;
    toBackend: string;
    reason: "sandbox_unavailable" | "persistent_sandbox_unsupported";
    rule: string;
    approvalId?: string;
    scope?: "once" | "session";
  };
};
