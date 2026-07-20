import type { AgentEventSink } from "../Events/AgentEvent.js";

export interface SeneraProcessFallbackSubject {
  readonly pluginName: string;
  readonly pluginTitle: string;
  readonly pluginVersion: string;
  readonly manifestDigest: string;
  readonly rootKind: "System" | "User";
  readonly trustLevel?: string;
  readonly toolName: string;
  readonly boundary: "Sandbox" | "SandboxPreferred";
  readonly network: "Allow" | "Deny";
  readonly workspace: "ReadOnly" | "ReadWrite";
  readonly permissions: readonly string[];
}

export interface SeneraProcessFallbackContext {
  readonly sessionId: string;
  readonly requestId: string;
  readonly step: number;
  readonly toolCallId?: string;
  readonly batchId?: string;
  readonly onEvent?: AgentEventSink;
  readonly subject: SeneraProcessFallbackSubject;
}

export interface SeneraProcessFallbackAuthorizationRequest {
  readonly fromBackend: string;
  readonly toBackend: string;
  readonly reason:
    | "sandbox_unavailable"
    | "persistent_sandbox_unsupported"
    | "terminal_capability_unsupported"
    | "shell_dialect_unsupported";
  readonly error: Error;
  readonly context: SeneraProcessFallbackContext;
  readonly signal?: AbortSignal;
}

export interface SeneraProcessFallbackAuthorization {
  readonly rule: string;
  readonly reason: string;
  readonly approvalId?: string;
  readonly scope?: "once" | "session";
}

export interface SeneraProcessFallbackAuthorizer {
  authorize(request: SeneraProcessFallbackAuthorizationRequest): Promise<SeneraProcessFallbackAuthorization>;
}

export const DenySeneraProcessFallbackAuthorizer: SeneraProcessFallbackAuthorizer = {
  async authorize(request) {
    throw request.error;
  },
};
