import type { AgentExtensionLocalizedText } from "../Extensions/AgentExtensionLocalization.js";

/**
 * Icons are part of the System Tool presentation contract. Keeping the small
 * vocabulary here lets extension manifests, backend events, and the workflow
 * UI agree without a second frontend-only name mapping.
 */
export const AgentToolPresentationIconNames = [
  "tools",
  "search",
  "blocks",
  "list-checks",
  "file-text",
  "pencil",
  "terminal",
  "clock",
  "activity",
  "git-branch",
  "users",
  "brain",
  "book-open",
  "calendar-clock",
  "image",
  "message-question",
  "globe",
] as const;

export type AgentToolPresentationIcon = (typeof AgentToolPresentationIconNames)[number];

/**
 * A result row is declared by the tool that owns the result contract. `pointer`
 * addresses a collection (usually ending in `/*`); the remaining pointers are
 * relative to each matched item. This keeps the UI generic for tuple and
 * object-shaped results alike.
 */
export interface AgentToolPresentationPreviewRow {
  readonly pointer: string;
  readonly titlePath: string;
  readonly descriptionPath?: string;
  readonly metaPath?: string;
}

export interface AgentToolPresentationPreviewMore {
  /** Pointer to the omitted collection or source summary. */
  readonly pointer: string;
  /** Relative numeric pointer when the collection stores grouped counts. */
  readonly countPath?: string;
  readonly label: AgentExtensionLocalizedText;
}

export interface AgentToolPresentationPreviewResult {
  readonly rows: readonly AgentToolPresentationPreviewRow[];
  readonly maxRows?: number;
  readonly more?: AgentToolPresentationPreviewMore;
}

export interface AgentToolPresentationPreview {
  readonly parameters?: readonly {
    readonly label: AgentExtensionLocalizedText;
    readonly pointer: string;
  }[];
  readonly result?: AgentToolPresentationPreviewResult;
}

export type AgentToolPresentationMeasureSource = "argument" | "result" | "env";
export type AgentToolPresentationMeasureAggregate = "first" | "count" | "sum" | "max" | "join";
export type AgentToolPresentationMeasureValueType = "text" | "path" | "number" | "boolean" | "enum" | "delta";
/**
 * `delta` values may be stored as signed changes or as non-negative counts.
 * `negative-only` renders either representation as a negative contribution,
 * which is useful for fields such as `removedLines` that are counts in the
 * result contract but represent a negative direction in the UI.
 */
export type AgentToolPresentationSign = "always" | "never" | "positive-only" | "negative-only";
export type AgentToolPresentationZeroPolicy = "omit" | "show";

export interface AgentToolPresentationWhere {
  readonly field: string;
  readonly equals: string | number | boolean;
}

/**
 * A named value read from the tool call. `argument` reads the call arguments,
 * `result` reads the projected result presentation object (not the raw tool
 * return value), and `env` reads a closed set of host facts.
 */
export interface AgentToolPresentationMeasure {
  readonly id: string;
  readonly from: AgentToolPresentationMeasureSource;
  /** RFC 6901 pointer to a collection or scalar; `*` selects every entry. */
  readonly pointer: string;
  readonly field?: string;
  readonly where?: AgentToolPresentationWhere;
  readonly aggregate: AgentToolPresentationMeasureAggregate;
  readonly type: AgentToolPresentationMeasureValueType;
  readonly separator?: string;
  readonly unit?: string;
  readonly precision?: number;
  readonly sign: AgentToolPresentationSign;
  readonly zero: AgentToolPresentationZeroPolicy;
  readonly labels?: Readonly<Record<string, AgentExtensionLocalizedText>>;
}

/**
 * A per-call branch. Variants are matched in array order, and the entry
 * without `when` is the fallback, so it must be declared last.
 */
export interface AgentToolPresentationVariant {
  readonly id: string;
  readonly when?: {
    readonly measure: string;
    readonly equals: string | number | boolean;
  };
  readonly action?: AgentExtensionLocalizedText;
  readonly invocationName?: AgentExtensionLocalizedText;
  readonly argumentPath?: string;
  readonly detailPaths?: readonly string[];
  readonly title?: string;
}

/**
 * Presentation contract v2. It is additive: a contract that declares no `v2`
 * resolves and renders exactly as it did before.
 */
export interface AgentToolPresentationActivityV2 {
  readonly measures: readonly AgentToolPresentationMeasure[];
  readonly variants: readonly AgentToolPresentationVariant[];
  readonly title?: string;
}

/**
 * UI-only metadata carried with a registered tool and its lifecycle events.
 * It deliberately has no bearing on authorization, scheduling, or provider
 * schema exposure.
 */
export interface AgentToolPresentation {
  readonly category: string;
  readonly icon: AgentToolPresentationIcon;
  readonly group: {
    readonly id: string;
    readonly title: AgentExtensionLocalizedText;
  };
  readonly activity: {
    readonly action: AgentExtensionLocalizedText;
    readonly invocationName?: AgentExtensionLocalizedText;
    /** RFC 6901 pointer pattern for the most useful argument preview. */
    readonly argumentPath?: string;
    /** RFC 6901 pointer patterns for supplementary argument previews. */
    readonly detailPaths?: readonly string[];
    /** Declarative label derivation; absent contracts keep the v1 behaviour. */
    readonly v2?: AgentToolPresentationActivityV2;
  };
  readonly preview?: AgentToolPresentationPreview;
}

/** A package or Tool contract may refine any inherited domain field. */
export interface AgentToolPresentationOverride {
  readonly category?: string;
  readonly icon?: AgentToolPresentationIcon;
  readonly group?: Partial<AgentToolPresentation["group"]>;
  readonly activity?: Partial<AgentToolPresentation["activity"]>;
  readonly preview?: AgentToolPresentationPreview;
}
