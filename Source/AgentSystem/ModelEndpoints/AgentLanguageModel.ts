/**
 * Provider-neutral visual input. The raw data is kept outside the textual
 * prompt so endpoint adapters can project it using their native wire format.
 */
export interface AgentLanguageModelImageAttachment {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
}

/**
 * Invocation data shared by structured planner calls. Attachments are
 * deliberately orthogonal to the structured prompt payload: image bytes must
 * reach the model as multimodal input, never as serialized prompt text.
 */
export interface AgentLanguageModelInvocationOptions {
  readonly signal?: AbortSignal;
  readonly attachments?: readonly AgentLanguageModelImageAttachment[];
  readonly cache?: AgentLanguageModelCacheOptions;
}

export type AgentModelCacheRetention = "none" | "short" | "long";

/** Provider-neutral prompt-cache affinity passed through Pi. */
export interface AgentLanguageModelCacheOptions {
  /** Provider-facing affinity/session scope. This is intentionally opaque. */
  readonly scope: string;
  readonly retention: AgentModelCacheRetention;
  /** Senera's physical session identity, kept separate from the provider scope. */
  readonly sessionId?: string;
  /** Stable logical scope used to correlate physical provider sessions. */
  readonly logicalCacheScope?: string;
  /** Digest and byte count of the immutable prefix sent before turn data. */
  readonly stablePrefixRevision?: string;
  readonly stablePrefixBytes?: number;
}

/** Invocation contract for model calls whose immutable system prefix is owned by the caller. */
export interface AgentStablePromptInvocationOptions extends AgentLanguageModelInvocationOptions {
  readonly stableSystemPrompt: string;
  readonly cache: AgentLanguageModelCacheOptions;
}

export interface AgentLanguageModelMessage {
  role: "system" | "developer" | "user" | "assistant";
  content: string;
  /** Native multimodal attachments for this message. */
  attachments?: readonly AgentLanguageModelImageAttachment[];
}
