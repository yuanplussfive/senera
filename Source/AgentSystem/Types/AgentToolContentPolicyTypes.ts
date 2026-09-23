/**
 * Declarative ownership and processing contract for tool output.
 *
 * The contract is intentionally orthogonal to observationProjection:
 * contentPolicy decides whether a result may be transformed and which
 * content operation is appropriate; observationProjection still owns the
 * final token budget and structural limits.
 */
export const AgentToolContentPolicyOwnerships = {
  Host: "host",
  Tool: "tool",
} as const;

export type AgentToolContentPolicyOwnership =
  (typeof AgentToolContentPolicyOwnerships)[keyof typeof AgentToolContentPolicyOwnerships];

export const AgentToolContentPolicyKinds = {
  Opaque: "opaque",
  Structured: "structured",
  WebReadable: "web-readable",
  Execution: "execution",
  AssetReference: "asset-reference",
} as const;

export type AgentToolContentPolicyKind = (typeof AgentToolContentPolicyKinds)[keyof typeof AgentToolContentPolicyKinds];

export const AgentToolContentPolicyRepresentations = {
  Preserve: "preserve",
  Text: "text",
  Markdown: "markdown",
  Html: "html",
  Json: "json",
} as const;

export type AgentToolContentPolicyRepresentation =
  (typeof AgentToolContentPolicyRepresentations)[keyof typeof AgentToolContentPolicyRepresentations];

export const AgentToolContentPolicyCompressionModes = {
  None: "none",
  Bounded: "bounded",
} as const;

export type AgentToolContentPolicyCompressionMode =
  (typeof AgentToolContentPolicyCompressionModes)[keyof typeof AgentToolContentPolicyCompressionModes];

export const AgentToolContentPolicyDeduplicationModes = {
  None: "none",
  ProseOnly: "prose-only",
} as const;

export type AgentToolContentPolicyDeduplicationMode =
  (typeof AgentToolContentPolicyDeduplicationModes)[keyof typeof AgentToolContentPolicyDeduplicationModes];

export const AgentToolContentPolicyPreservables = {
  Code: "code",
  Json: "json",
  Logs: "logs",
  Urls: "urls",
  Identifiers: "identifiers",
} as const;

export type AgentToolContentPolicyPreservable =
  (typeof AgentToolContentPolicyPreservables)[keyof typeof AgentToolContentPolicyPreservables];

/** RFC 6901 targets. An empty pointer targets the complete result. */
export interface AgentToolContentPolicy {
  readonly ownership: AgentToolContentPolicyOwnership;
  readonly kind: AgentToolContentPolicyKind;
  readonly representation: AgentToolContentPolicyRepresentation;
  /** `bounded` enables host normalization and adaptive extractive projection when needed. */
  readonly compression: AgentToolContentPolicyCompressionMode;
  readonly deduplication: AgentToolContentPolicyDeduplicationMode;
  readonly targets?: readonly string[];
  readonly preserve?: readonly AgentToolContentPolicyPreservable[];
}

export const AgentToolContentProjectionReasons = {
  ToolOwned: "tool_owned",
  Opaque: "opaque",
  Structured: "structured",
  Execution: "execution",
  AssetReference: "asset_reference",
  Applied: "applied",
} as const;

export type AgentToolContentProjectionReason =
  (typeof AgentToolContentProjectionReasons)[keyof typeof AgentToolContentProjectionReasons];

export interface AgentToolContentProjectionStats {
  readonly sourceCharacters: number;
  readonly projectedCharacters: number;
  readonly removedCharacters: number;
  readonly transformedTargets: number;
}

export interface AgentToolContentProjection {
  readonly value: unknown;
  readonly policy?: AgentToolContentPolicy;
  readonly reason: AgentToolContentProjectionReason;
  readonly stats: AgentToolContentProjectionStats;
  readonly omissions?: readonly string[];
}
