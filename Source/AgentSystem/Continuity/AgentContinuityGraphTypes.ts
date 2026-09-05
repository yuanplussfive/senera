import type {
  AgentContinuityAuthority,
  AgentContinuityScopeRef,
  AgentContinuityTemporalWindow,
} from "./AgentContinuityDomain.js";
import type {
  AgentContinuityEntityKind,
  AgentContinuityRelationCardinality,
} from "./AgentContinuityRelationCatalog.js";

export interface AgentContinuityGraphEntity {
  readonly uri: string;
  readonly label: string;
  readonly aliases: readonly string[];
  readonly kind: AgentContinuityEntityKind;
  readonly scope: AgentContinuityScopeRef;
  readonly status: "active" | "merged" | "retired";
  readonly mergedIntoUri: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentContinuityGraphRelation {
  readonly id: string;
  readonly uri: string;
  readonly subjectUri: string;
  readonly relationId: string;
  readonly relationLabel: string;
  readonly objectUri: string;
  readonly scope: AgentContinuityScopeRef;
  readonly cardinality: AgentContinuityRelationCardinality;
  readonly temporal: AgentContinuityTemporalWindow;
  readonly authority: AgentContinuityAuthority;
  readonly confidence: number;
  readonly sourceRefs: readonly string[];
  readonly supportCount: number;
  readonly supportMass: number;
  readonly maturity: "candidate" | "active" | "established";
  readonly status: "active" | "superseded" | "retracted";
  readonly supersededBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Compact, label-based relation card used in the model prompt. */
export interface AgentContinuityGraphPromptRelation {
  readonly subject: string;
  readonly subjectKind: AgentContinuityEntityKind;
  readonly relationId: string;
  readonly relation: string;
  readonly object: string;
  readonly objectKind: AgentContinuityEntityKind;
  readonly temporal: AgentContinuityTemporalWindow;
  readonly confidence: number;
  readonly maturity: "candidate" | "active" | "established";
}

export interface AgentContinuityGraphRelationDraft {
  readonly subjectUri: string;
  readonly relationId: string;
  readonly objectUri: string;
  readonly scope: AgentContinuityScopeRef;
  readonly temporal: AgentContinuityTemporalWindow;
  readonly authority: AgentContinuityAuthority;
  readonly confidence: number;
  readonly sourceRefs: readonly string[];
  readonly observedAt: string;
}

/** Model-independent relation candidate; labels are resolved to entity URIs by the host. */
export interface AgentContinuityGraphRelationCandidate {
  readonly subjectLabel: string;
  readonly relationId: string;
  readonly objectLabel: string;
  readonly scope: AgentContinuityScopeRef;
  readonly temporal: AgentContinuityTemporalWindow;
  readonly authority: AgentContinuityAuthority;
  readonly confidence: number;
  readonly sourceRefs: readonly string[];
  readonly observedAt: string;
}

export interface AgentContinuityGraphRelationEvidence {
  readonly relationUri: string;
  readonly evidenceKey: string;
  readonly sourceRefs: readonly string[];
  readonly authority: AgentContinuityAuthority;
  readonly confidence: number;
  readonly observedAt: string;
}

export interface AgentContinuityGraphSnapshot {
  readonly scope: readonly AgentContinuityScopeRef[];
  readonly entities: readonly AgentContinuityGraphEntity[];
  readonly relations: readonly AgentContinuityGraphRelation[];
}

export interface AgentContinuityGraphRelationQuery {
  readonly includeInactive?: boolean;
  readonly entityUris?: readonly string[];
}
