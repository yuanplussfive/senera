import type { Api, AssistantImages, AssistantMessage, AssistantMessageEvent, Model } from "@earendil-works/pi-ai";

/**
 * Diagnostic type definitions and source identifiers for the Pi agent.
 *
 * Shared with server diagnostics without coupling Pi to a transport. The diagnostic emission functions (emitAgentPiDiagnostic,
 * createAgentPiDiagnosticEvent, etc.) remain in Pi/AgentPiDiagnostics.ts and
 * import these types from here.
 */

export const AgentPiDiagnosticSources = {
  Session: "session",
  Provider: "provider",
  Substrate: "substrate",
} as const;

export type AgentPiDiagnosticSource = (typeof AgentPiDiagnosticSources)[keyof typeof AgentPiDiagnosticSources];

export interface AgentPiDiagnosticContext {
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly step?: number;
  readonly toolCallId?: string;
  readonly modelMessageIndex?: number;
}

export interface AgentPiDiagnosticInput {
  readonly context?: AgentPiDiagnosticContext;
  readonly source: AgentPiDiagnosticSource;
  readonly name: string;
  readonly summary?: string;
  readonly details?: unknown;
  readonly detailId?: string;
}

export interface AgentPiDiagnosticEvent {
  readonly context: AgentPiDiagnosticContext;
  readonly source: AgentPiDiagnosticSource;
  readonly name: string;
  readonly summary: string;
  readonly details?: unknown;
  readonly detailId?: string;
}

export type AgentPiDiagnosticSink = ((event: AgentPiDiagnosticEvent) => void | Promise<void>) & {
  readonly providerStream?: AgentProviderStreamFactory;
};

export type AgentProviderStreamRequestStatus = "completed" | "failed" | "aborted" | "validation_failed" | "incomplete";

export interface AgentProviderStreamInput {
  readonly context?: AgentPiDiagnosticContext;
  readonly providerId: string;
  readonly stage: string;
  readonly invocationId?: string;
  readonly model: Pick<Model<Api>, "provider" | "api" | "id">;
  readonly secrets?: readonly string[];
}

export interface AgentProviderStreamCapture {
  onProviderStreamEvent(data: unknown, model: Model<Api>): void;
  observe(event: AssistantMessageEvent): void;
  observeResult(result: AgentProviderTerminalResult): void;
  finish(status: AgentProviderStreamRequestStatus, error?: unknown): void;
}

/** Common Pi terminal metadata; image operations do not manufacture chat stream events. */
export type AgentProviderTerminalResult = Pick<
  AssistantMessage | AssistantImages,
  "api" | "provider" | "model" | "stopReason" | "usage"
> &
  Partial<Pick<AssistantMessage, "rawStopReason" | "responseModel">>;

export type AgentProviderStreamFactory = (input: AgentProviderStreamInput) => AgentProviderStreamCapture;
