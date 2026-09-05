import type {
  AgentContinuityAuthority,
  AgentContinuityConditionTrace,
  AgentContinuityPromptRule,
  AgentContinuityRuleStatus,
  AgentContinuityTruth,
} from "./AgentContinuityDomain.js";
import type { AgentResidentProfilePromptEntry } from "../Profile/AgentResidentProfileTypes.js";
import type { AgentContinuityConceptRecord } from "./AgentContinuityConceptCatalog.js";
import type { AgentContinuityGraphPromptRelation, AgentContinuityGraphSnapshot } from "./AgentContinuityGraphTypes.js";
import type { AgentTemporalMemoryOverview } from "../TemporalMemory/AgentTemporalMemoryTypes.js";
import type { AgentContinuityStyleExample } from "./AgentContinuityStyleExamples.js";

export interface AgentContinuityEvidenceCandidate {
  readonly sourceRefs: readonly string[];
  readonly score: number;
  readonly matchedBy: readonly string[];
}

export interface AgentContinuityEventCandidate {
  readonly sourceRefs: readonly string[];
  /** Short host-generated event summary; exact evidence remains behind sourceRefs. */
  readonly summary: string;
  readonly occurredAt: string;
  readonly score: number;
  readonly matchedBy: readonly string[];
}

export interface AgentContinuityFactCatalogEntry {
  readonly factKey: string;
  readonly claim: string;
  readonly sourceRefs: readonly string[];
  readonly confidence: number;
  readonly authority: AgentContinuityAuthority;
  /** When the current claim version became authoritative. */
  readonly validFrom: string;
  readonly validUntil?: string;
  readonly supportCount: number;
  readonly supportMass: number;
  readonly maturity: "candidate" | "active" | "established";
  readonly updatedAt: string;
  readonly score: number;
  readonly matchedBy: readonly string[];
}

export interface AgentContinuityRecallSelectionCount {
  readonly available: number;
  readonly matched: number;
  readonly selected: number;
}

/** Observability-only record of why ranked records fell out of the recall funnel. */
export interface AgentContinuityRecallRejections {
  readonly belowSimilarity: number;
  readonly belowCandidate: number;
  readonly funnelSkipped: number;
}

/** A record that passed the similarity floor but missed the candidate threshold; never injected into the model prompt. */
export interface AgentContinuityNearMissEntry {
  readonly summary: string;
  readonly score: number;
  readonly textSimilarityScore: number;
  readonly lexicalScore: number;
  readonly semanticScore: number;
  readonly matchedBy: readonly string[];
}

export interface AgentContinuityRecallSelection {
  readonly profiles: AgentContinuityRecallSelectionCount;
  readonly facts: AgentContinuityRecallSelectionCount;
  readonly relations: AgentContinuityRecallSelectionCount;
  readonly events: AgentContinuityRecallSelectionCount;
  readonly evidence: AgentContinuityRecallSelectionCount;
  /** Locally selected quoted dialogue examples; optional for old snapshots. */
  readonly styleExamples?: AgentContinuityRecallSelectionCount;
  readonly usedCharacters: number;
  readonly maxCharacters: number;
}

export interface AgentContinuityPromptSignal {
  readonly uri: string;
  readonly summary: string;
  readonly valueJson: string;
  readonly valueType: "boolean" | "number" | "string" | "json";
  readonly observedAt: string;
  /** Stable Liquid boundary: empty when the state has no expiration. */
  readonly expiresAt: string;
}

export interface AgentContinuityRuleSnapshotEntry {
  readonly uri: string;
  readonly title: string;
  readonly action: string;
  readonly actionKind: "recall" | "notify";
  readonly activation: "while_true" | "once";
  readonly status: AgentContinuityRuleStatus;
  readonly truth: AgentContinuityTruth;
  readonly score: number;
  readonly threshold: number;
  readonly missingSignals: readonly string[];
  readonly conditions: readonly AgentContinuityConditionTrace[];
  readonly authority: AgentContinuityAuthority;
  readonly confidence: number;
  readonly supportCount: number;
  readonly maturity: "candidate" | "active" | "established";
  readonly validUntil?: string;
  readonly lastEvaluatedAt?: string;
  readonly lastTriggeredAt?: string;
}

export interface AgentContinuityRulesSnapshot {
  readonly rules: readonly AgentContinuityRuleSnapshotEntry[];
  readonly signals: readonly AgentContinuityPromptSignal[];
}

export interface AgentContinuityMemoryPromptContext {
  readonly enabled: boolean;
  /** Host-owned cross-domain identities visible to observability, not rendered into the model prompt. */
  readonly concepts: readonly AgentContinuityConceptRecord[];
  /** Complete active graph view for observability; only graphRelations enter the prompt. */
  readonly graph: AgentContinuityGraphSnapshot;
  /** Query-selected graph edges projected without internal identifiers. */
  readonly graphRelations: readonly AgentContinuityGraphPromptRelation[];
  /** Observability-only temporal digest health and latest sealed representative for each level. */
  readonly temporalMemory: AgentTemporalMemoryOverview;
  readonly residentProfile: readonly AgentResidentProfilePromptEntry[];
  /** Relevant prior dialogue examples, kept outside the stable prompt prefix. */
  readonly styleExamples?: readonly AgentContinuityStyleExample[];
  /** Query-selected current fact heads, ordered by recall relevance. */
  readonly factCatalog: readonly AgentContinuityFactCatalogEntry[];
  readonly selection: AgentContinuityRecallSelection;
  /** Observability-only funnel diagnostics; never rendered into the model prompt. */
  readonly rejections: AgentContinuityRecallRejections;
  readonly nearMisses: readonly AgentContinuityNearMissEntry[];
  /** Internal delivery receipts; templates and browser snapshots must not render these identifiers. */
  readonly pendingRuleDeliveryUris: readonly string[];
  readonly evidenceCandidates: readonly AgentContinuityEvidenceCandidate[];
  readonly eventCandidates: readonly AgentContinuityEventCandidate[];
  readonly activeRules: readonly AgentContinuityPromptRule[];
  readonly ruleCatalog: readonly AgentContinuityRuleSnapshotEntry[];
  readonly signals: readonly AgentContinuityPromptSignal[];
}

export const EmptyAgentContinuityMemoryPromptContext: AgentContinuityMemoryPromptContext = {
  enabled: false,
  concepts: [],
  graph: { scope: [], entities: [], relations: [] },
  graphRelations: [],
  temporalMemory: { counts: [], segmentDecisions: [], latestSealed: [] },
  residentProfile: [],
  styleExamples: [],
  factCatalog: [],
  selection: {
    profiles: { available: 0, matched: 0, selected: 0 },
    facts: { available: 0, matched: 0, selected: 0 },
    relations: { available: 0, matched: 0, selected: 0 },
    events: { available: 0, matched: 0, selected: 0 },
    evidence: { available: 0, matched: 0, selected: 0 },
    usedCharacters: 0,
    maxCharacters: 0,
  },
  rejections: { belowSimilarity: 0, belowCandidate: 0, funnelSkipped: 0 },
  nearMisses: [],
  pendingRuleDeliveryUris: [],
  evidenceCandidates: [],
  eventCandidates: [],
  activeRules: [],
  ruleCatalog: [],
  signals: [],
};
