import type { AgentRoleplayPresetContext } from "../Presets/AgentPresetTypes.js";
import type { AgentContinuityMemoryPromptContext } from "./AgentContinuityMemoryTypes.js";
import type { AgentResidentProfilePromptEntry } from "../Profile/AgentResidentProfileTypes.js";
import type { AgentContinuityGraphPromptRelation, AgentContinuityGraphSnapshot } from "./AgentContinuityGraphTypes.js";

/** Browser-safe account of continuity state and records selected for one turn. */
export interface AgentContinuitySnapshot {
  readonly enabled: boolean;
  readonly concepts: readonly {
    readonly uri: string;
    readonly label: string;
    readonly aliases: readonly string[];
    readonly entityKind: string;
    readonly scope: { readonly kind: string; readonly id: string };
    readonly recordKinds: readonly ("fact" | "profile" | "signal" | "rule")[];
    readonly recordCount: number;
    readonly updatedAt: string;
  }[];
  readonly graph: AgentContinuityGraphSnapshot;
  readonly graphRelations: readonly AgentContinuityGraphPromptRelation[];
  readonly temporalMemory: {
    readonly counts: readonly {
      readonly granularity: "segment" | "day" | "month";
      readonly status: "open" | "pending" | "sealed" | "failed" | "stale";
      readonly count: number;
    }[];
    readonly segmentDecisions: readonly {
      readonly status: "pending" | "resolved" | "failed";
      readonly count: number;
    }[];
    readonly latestSealed: readonly {
      readonly uri: string;
      readonly granularity: "segment" | "day" | "month";
      readonly periodStart: string;
      readonly periodEnd: string;
      readonly timeZone: string;
      readonly summary: string;
      readonly topics: readonly string[];
      readonly openLoops: readonly string[];
      readonly sourceCount: number;
    }[];
  };
  readonly residentProfile: readonly AgentResidentProfilePromptEntry[];
  readonly factCatalog: readonly {
    readonly factKey: string;
    readonly claim: string;
    readonly sourceRefs: readonly string[];
    readonly confidence: number;
    readonly authority: string;
    readonly validFrom: string;
    readonly validUntil?: string;
    readonly supportCount: number;
    readonly supportMass: number;
    readonly maturity: "candidate" | "active" | "established";
    readonly updatedAt: string;
    readonly score: number;
    readonly matchedBy: readonly string[];
  }[];
  readonly selection: AgentContinuityMemoryPromptContext["selection"];
  /** Observability-only funnel diagnostics; not part of the model prompt. */
  readonly rejections: AgentContinuityMemoryPromptContext["rejections"];
  readonly nearMisses: AgentContinuityMemoryPromptContext["nearMisses"];
  readonly preset: {
    readonly enabled: boolean;
    readonly activePresetName: string | null;
    readonly title?: string;
    readonly corePersona?: string;
    readonly languageStyle?: string;
  };
  readonly evidenceCandidates: readonly {
    readonly sourceRefs: readonly string[];
    readonly score: number;
    readonly matchedBy: readonly string[];
  }[];
  readonly eventCandidates: readonly {
    readonly sourceRefs: readonly string[];
    readonly summary: string;
    readonly occurredAt: string;
    readonly score: number;
    readonly matchedBy: readonly string[];
  }[];
  readonly rules: readonly {
    readonly uri: string;
    readonly title: string;
    readonly action: string;
    readonly actionKind: "recall" | "notify";
    readonly activation: "while_true" | "once";
    readonly status: "armed" | "partial" | "triggered" | "resolved" | "cancelled" | "expired";
    readonly truth: "true" | "false" | "unknown";
    readonly score: number;
    readonly threshold: number;
    readonly missingSignals: readonly string[];
    readonly conditions: readonly {
      readonly label: string;
      readonly truth: "true" | "false" | "unknown";
      readonly score: number;
      readonly actual?: string | number | boolean;
    }[];
    readonly authority: string;
    readonly confidence: number;
    readonly supportCount: number;
    readonly maturity: "candidate" | "active" | "established";
    readonly validUntil?: string;
    readonly lastEvaluatedAt?: string;
    readonly lastTriggeredAt?: string;
  }[];
  readonly signals: readonly {
    readonly uri: string;
    readonly summary: string;
    readonly valueJson: string;
    readonly valueType: "boolean" | "number" | "string" | "json";
    readonly observedAt: string;
    readonly expiresAt?: string;
  }[];
}

export function projectAgentContinuitySnapshot(
  roleplayPreset: AgentRoleplayPresetContext,
  continuityMemory: AgentContinuityMemoryPromptContext,
): AgentContinuitySnapshot {
  return {
    enabled: continuityMemory.enabled,
    concepts: continuityMemory.concepts.map((concept) => ({
      uri: concept.uri,
      label: concept.label,
      aliases: [...concept.aliases],
      entityKind: concept.entityKind,
      scope: { ...concept.scope },
      recordKinds: [...concept.recordKinds],
      recordCount: concept.recordCount,
      updatedAt: concept.updatedAt,
    })),
    residentProfile: continuityMemory.residentProfile.map((entry) => ({ ...entry })),
    graph: {
      scope: continuityMemory.graph.scope.map((scope) => ({ ...scope })),
      entities: continuityMemory.graph.entities.map((entity) => ({
        ...entity,
        aliases: [...entity.aliases],
        scope: { ...entity.scope },
      })),
      relations: continuityMemory.graph.relations.map((relation) => ({
        ...relation,
        scope: { ...relation.scope },
        temporal: { ...relation.temporal },
        sourceRefs: [...relation.sourceRefs],
      })),
    },
    graphRelations: continuityMemory.graphRelations.map((relation) => ({
      ...relation,
      temporal: { ...relation.temporal },
    })),
    temporalMemory: {
      counts: continuityMemory.temporalMemory.counts.map((entry) => ({ ...entry })),
      segmentDecisions: continuityMemory.temporalMemory.segmentDecisions.map((entry) => ({ ...entry })),
      latestSealed: continuityMemory.temporalMemory.latestSealed.map((digest) => ({
        uri: digest.uri,
        granularity: digest.granularity,
        periodStart: digest.periodStart,
        periodEnd: digest.periodEnd,
        timeZone: digest.timeZone,
        summary: digest.summary,
        topics: [...digest.topics],
        openLoops: [...digest.openLoops],
        sourceCount: digest.childCount,
      })),
    },
    factCatalog: continuityMemory.factCatalog.map((fact) => ({
      factKey: fact.factKey,
      claim: fact.claim,
      sourceRefs: [...fact.sourceRefs],
      confidence: fact.confidence,
      authority: fact.authority,
      validFrom: fact.validFrom,
      ...(fact.validUntil ? { validUntil: fact.validUntil } : {}),
      supportCount: fact.supportCount,
      supportMass: fact.supportMass,
      maturity: fact.maturity,
      updatedAt: fact.updatedAt,
      score: fact.score,
      matchedBy: [...fact.matchedBy],
    })),
    selection: {
      profiles: { ...continuityMemory.selection.profiles },
      facts: { ...continuityMemory.selection.facts },
      relations: { ...continuityMemory.selection.relations },
      events: { ...continuityMemory.selection.events },
      evidence: { ...continuityMemory.selection.evidence },
      usedCharacters: continuityMemory.selection.usedCharacters,
      maxCharacters: continuityMemory.selection.maxCharacters,
    },
    rejections: { ...continuityMemory.rejections },
    nearMisses: continuityMemory.nearMisses.map((nearMiss) => ({
      summary: nearMiss.summary,
      score: nearMiss.score,
      textSimilarityScore: nearMiss.textSimilarityScore,
      lexicalScore: nearMiss.lexicalScore,
      semanticScore: nearMiss.semanticScore,
      matchedBy: [...nearMiss.matchedBy],
    })),
    preset: {
      enabled: roleplayPreset.enabled,
      activePresetName: roleplayPreset.activePresetName,
      ...(roleplayPreset.card
        ? {
            title: roleplayPreset.card.title,
            corePersona: roleplayPreset.card.corePersona,
            languageStyle: roleplayPreset.card.languageStyle,
          }
        : {}),
    },
    evidenceCandidates: continuityMemory.evidenceCandidates.map((entry) => ({
      sourceRefs: [...entry.sourceRefs],
      score: entry.score,
      matchedBy: [...entry.matchedBy],
    })),
    eventCandidates: continuityMemory.eventCandidates.map((entry) => ({
      sourceRefs: [...entry.sourceRefs],
      summary: entry.summary,
      occurredAt: entry.occurredAt,
      score: entry.score,
      matchedBy: [...entry.matchedBy],
    })),
    rules: continuityMemory.ruleCatalog.map((rule) => ({
      uri: rule.uri,
      title: rule.title,
      action: rule.action,
      actionKind: rule.actionKind,
      activation: rule.activation,
      status: rule.status,
      truth: rule.truth,
      score: rule.score,
      threshold: rule.threshold,
      missingSignals: [...rule.missingSignals],
      conditions: rule.conditions.map((condition) => ({ ...condition })),
      authority: rule.authority,
      confidence: rule.confidence,
      supportCount: rule.supportCount,
      maturity: rule.maturity,
      ...(rule.validUntil ? { validUntil: rule.validUntil } : {}),
      ...(rule.lastEvaluatedAt ? { lastEvaluatedAt: rule.lastEvaluatedAt } : {}),
      ...(rule.lastTriggeredAt ? { lastTriggeredAt: rule.lastTriggeredAt } : {}),
    })),
    signals: continuityMemory.signals.map(({ expiresAt, ...signal }) => ({
      ...signal,
      ...(expiresAt ? { expiresAt } : {}),
    })),
  };
}
