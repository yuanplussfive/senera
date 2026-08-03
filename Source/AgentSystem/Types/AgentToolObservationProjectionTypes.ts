export const AgentToolObservationProjectionSchemaVersion = 1 as const;

export const AgentToolObservationProjectionSources = {
  Headline: "headline",
  Summary: "summary",
  Error: "error",
  Process: "process",
  Retrieval: "retrieval",
  Continuation: "continuation",
  Evidence: "evidence",
  Delta: "delta",
  Workspace: "workspace",
  Result: "result",
  Arguments: "arguments",
  ArtifactProjection: "projection",
  SummaryFacts: "summaryFacts",
  Limitations: "limitations",
  Outcome: "outcome",
} as const;

export type AgentToolObservationProjectionSource =
  (typeof AgentToolObservationProjectionSources)[keyof typeof AgentToolObservationProjectionSources];

export const AgentToolObservationProjectionModes = {
  Auto: "auto",
  Text: "text",
  Json: "json",
  OrderedArray: "orderedArray",
  ArtifactOnly: "artifactOnly",
} as const;

export type AgentToolObservationProjectionMode =
  (typeof AgentToolObservationProjectionModes)[keyof typeof AgentToolObservationProjectionModes];

export const AgentToolObservationPriorityTiers = {
  Essential: "essential",
  High: "high",
  Normal: "normal",
  Low: "low",
} as const;

export type AgentToolObservationPriorityTier =
  (typeof AgentToolObservationPriorityTiers)[keyof typeof AgentToolObservationPriorityTiers];

export interface AgentToolObservationStructuralLimits {
  readonly maxDepth: number;
  readonly maxArrayItems: number;
  readonly maxObjectProperties: number;
  readonly maxStringCharacters: number;
  readonly maxTotalCharacters: number;
  readonly maxNodes: number;
}

export interface AgentToolObservationProjectionSourceRule {
  readonly source: AgentToolObservationProjectionSource;
  readonly mode: AgentToolObservationProjectionMode;
  readonly priority: AgentToolObservationPriorityTier;
  readonly pointer?: string;
  readonly maxTokens: number;
  readonly limits: AgentToolObservationStructuralLimits;
}

export interface AgentToolObservationContinuationProjection {
  readonly kind: "session" | "cursor" | "offset" | "artifact";
  readonly handle: string;
  readonly cursor?: string;
  readonly state?: string;
  readonly terminalStates?: readonly string[];
}

export interface AgentToolObservationArtifactFallback {
  readonly strategy: "reference";
  readonly requiredWhenTruncated: boolean;
}

export interface AgentToolObservationProjectionManifest {
  readonly schemaVersion: typeof AgentToolObservationProjectionSchemaVersion;
  readonly maxTokens: number;
  readonly maxOmissions: number;
  readonly artifactFallback: AgentToolObservationArtifactFallback;
  readonly continuation?: AgentToolObservationContinuationProjection;
  readonly sources: readonly AgentToolObservationProjectionSourceRule[];
}
