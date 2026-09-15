import crypto from "node:crypto";
import type { AgentMemoryRecordedTurn, AgentMemorySourceRecord } from "../Memory/AgentMemorySourceRepository.js";
import { DefaultAgentTimeZone } from "../Time/AgentTime.js";
import type {
  AgentContinuityObservation,
  AgentContinuityScopeRef,
  AgentContinuitySignal,
  AgentContinuityTemporalWindow,
} from "./AgentContinuityDomain.js";
import { AgentContinuityTextSimilarity } from "./AgentContinuityTextSimilarity.js";
import { AgentContinuityEvidenceLinker, type AgentContinuityEvidenceLink } from "./AgentContinuityEvidenceLinker.js";
import type {
  ParsedAgentContinuityAlwaysModel,
  ParsedAgentContinuityConditionalModel,
  ParsedAgentContinuityCaptureItem,
  ParsedAgentContinuityFactExtraction,
  ParsedAgentContinuityRuleExtraction,
  ParsedAgentContinuityStateModel,
} from "./AgentContinuityLearningSchema.js";
import type { AgentContinuityGraphRelationCandidate } from "./AgentContinuityGraphTypes.js";
import { compileAgentContinuityRuleCondition } from "./AgentContinuityPredicateCompiler.js";
import {
  resolveAgentContinuityStateIdentity,
  type AgentContinuityModelingContext,
} from "./AgentContinuityRuleContext.js";
import type { AgentContinuityRuleDraft } from "./AgentContinuitySqliteStore.js";
import {
  createAgentContinuitySemanticStateIdentity,
  type AgentContinuityStateIdentity,
} from "./AgentContinuityStateIdentity.js";
import { createAgentContinuityWatermark } from "./AgentContinuityWatermark.js";
import { AgentContinuityFactLifetimeResolver } from "./AgentContinuityFactLifetimeResolver.js";
import type { AgentResidentProfileDraft } from "../Profile/AgentResidentProfileTypes.js";
import {
  resolveAgentContinuityFactIdentity,
  type AgentContinuityFactIdentityCandidate,
} from "./AgentContinuityFactIdentity.js";
import { getAgentContinuityRelationDefinition } from "./AgentContinuityRelationCatalog.js";
import type { AgentContinuityFactHead } from "./AgentContinuitySqliteStore.js";
import { AgentContinuityRecallRankingDefaults } from "./AgentContinuityRecallDefaults.js";
import type { ResolvedAgentContinuityRecallRankingConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";
import { removeProfileBackedContinuityFacts } from "./AgentContinuityLearningDeduplication.js";
import { uniqueStrings } from "./AgentContinuitySqliteUtils.js";
import { requireAgentContinuityIdentity, type AgentContinuityIdentityContext } from "./AgentContinuityIdentityStore.js";

export interface AgentContinuityFactLearningDraft {
  readonly observations: readonly AgentContinuityObservation[];
  readonly profiles: readonly AgentResidentProfileDraft[];
  readonly relations: readonly AgentContinuityGraphRelationCandidate[];
  readonly facts: readonly string[];
}

export interface AgentContinuityRuleLearningDraft {
  readonly signals: readonly AgentContinuitySignal[];
  readonly rules: readonly AgentContinuityRuleDraft[];
}

export interface AgentContinuityCandidateCompilerOptions {
  readonly identity: AgentContinuityIdentityContext;
  readonly recordedTurn: AgentMemoryRecordedTurn;
  readonly observedAt: string;
  readonly existingFactHeads?: readonly AgentContinuityFactHead[];
  readonly factIdentityFuzzyScore?: number;
  readonly recallPolicy?: ResolvedAgentContinuityRecallRankingConfig;
}

/** Adds host-owned evidence and domain metadata to the two minimal model outputs. */
export class AgentContinuityCandidateCompiler {
  private readonly evidenceLinker: AgentContinuityEvidenceLinker;
  private readonly factLifetimeResolver: AgentContinuityFactLifetimeResolver;
  private readonly factSimilarity: AgentContinuityTextSimilarity;
  private readonly factIdentityCandidates: AgentContinuityFactIdentityCandidate[];
  private readonly factIdentityFuzzyScore: number;
  private readonly timeZone: string;

  constructor(private readonly options: AgentContinuityCandidateCompilerOptions) {
    const policy = options.recallPolicy ?? AgentContinuityRecallRankingDefaults;
    this.evidenceLinker = new AgentContinuityEvidenceLinker(policy);
    this.factLifetimeResolver = new AgentContinuityFactLifetimeResolver(policy);
    this.factSimilarity = new AgentContinuityTextSimilarity(policy.Similarity);
    this.factIdentityFuzzyScore = options.factIdentityFuzzyScore ?? policy.FactIdentityFuzzyScore;
    this.timeZone = options.recordedTurn.episode.timeZone || DefaultAgentTimeZone;
    this.factIdentityCandidates = (options.existingFactHeads ?? []).map((head) => ({
      factKey: head.factKey,
      claim: head.claim,
      scope: head.scope,
      updatedAt: head.updatedAt,
    }));
  }

  compileFacts(extraction: ParsedAgentContinuityFactExtraction): AgentContinuityFactLearningDraft {
    const observations: AgentContinuityObservation[] = [];
    const profiles: AgentResidentProfileDraft[] = [];
    const relations: AgentContinuityGraphRelationCandidate[] = [];
    for (const item of extraction.items) {
      const text = itemText(item);
      const evidence = this.evidenceLinker.link(text, this.options.recordedTurn.sources);
      if (item.kind === "fact") observations.push(this.compileFact(requireText(item), evidence));
      if (item.kind === "profile" || item.kind === "agent_profile") {
        profiles.push(this.compileProfile(item, evidence));
      }
      if (item.kind === "relation") relations.push(this.compileRelation(item, evidence));
    }
    return {
      observations: removeProfileBackedContinuityFacts({
        observations,
        profiles,
      }),
      profiles,
      relations,
      facts: extraction.items.map(itemText),
    };
  }

  compileRules(
    extraction: ParsedAgentContinuityRuleExtraction,
    modelingContext: Pick<AgentContinuityModelingContext, "statesByUri">,
  ): AgentContinuityRuleLearningDraft {
    const signals = extraction.items
      .filter((item): item is ParsedAgentContinuityStateModel => item.kind === "state")
      .map((item) =>
        this.compileState(
          item.title,
          item,
          modelingContext.statesByUri,
          this.evidenceLinker.link(`${item.title}: ${JSON.stringify(item.value)}`, this.options.recordedTurn.sources),
        ),
      );
    const rules = extraction.items
      .filter((item) => item.kind !== "state")
      .map((item) => {
        const evidence = this.evidenceLinker.link(
          ruleEvidenceText(item.title, item.effect ?? item.title),
          this.options.recordedTurn.sources,
        );
        if (item.kind === "always") return this.compileAlwaysRule(item.title, item, evidence);
        return this.compileConditionalRule(
          item.title,
          item,
          item.kind === "notify" ? "notify" : "recall",
          modelingContext.statesByUri,
          evidence,
        );
      });
    return {
      signals,
      rules,
    };
  }

  private compileFact(fact: string, evidence: AgentContinuityEvidenceLink): AgentContinuityObservation {
    const id = createFactId(this.options.recordedTurn.episode.uri, fact);
    const lifetime = this.factLifetimeResolver.resolve(fact, this.options.recordedTurn.sources);
    const scope = this.factScopeFor(lifetime.until);
    const identity = resolveAgentContinuityFactIdentity(
      fact,
      scope,
      this.factIdentityCandidates,
      this.factSimilarity,
      this.factIdentityFuzzyScore,
    );
    this.factIdentityCandidates.push({
      factKey: identity.factKey,
      claim: fact,
      scope,
      updatedAt: this.options.observedAt,
    });
    return {
      id,
      uri: `senera://continuity-learning/${id}`,
      kind: "learning.record",
      summary: fact,
      payload: { kind: "fact", fact, until: lifetime.until, factKey: identity.factKey },
      sourceRefs: this.sourceRefs(evidence, lifetime.source),
      watermark: createAgentContinuityWatermark(id),
      scope,
      authority: evidence.authority,
      confidence: evidence.confidence,
      occurredAt: this.options.recordedTurn.episode.completedAt,
      observedAt: this.options.observedAt,
      createdAtMs: Date.parse(this.options.observedAt),
    };
  }

  private compileProfile(
    item: ParsedAgentContinuityCaptureItem,
    evidence: AgentContinuityEvidenceLink,
  ): AgentResidentProfileDraft {
    const key = requireKey(item);
    const value = requireValue(item);
    const lifetime = this.factLifetimeResolver.resolve(itemText(item), this.options.recordedTurn.sources);
    return {
      subject: item.kind === "agent_profile" ? "agent" : "user",
      key,
      value,
      scope:
        lifetime.until === "session"
          ? { kind: "session", id: this.options.recordedTurn.episode.sessionId }
          : item.kind === "agent_profile"
            ? { kind: "world", id: requireAgentContinuityIdentity(this.options.identity, "world") }
            : { kind: "user", id: requireAgentContinuityIdentity(this.options.identity, "user") },
      authority: evidence.authority,
      confidence: evidence.confidence,
      temporal: { until: lifetime.until, timeZone: this.timeZone },
      sourceRefs: this.sourceRefs(evidence, lifetime.source),
    };
  }

  private compileRelation(
    item: ParsedAgentContinuityCaptureItem,
    evidence: AgentContinuityEvidenceLink,
  ): AgentContinuityGraphRelationCandidate {
    const lifetime = this.factLifetimeResolver.resolve(itemText(item), this.options.recordedTurn.sources);
    return {
      subjectLabel: requireFrom(item),
      relationId: requireRelation(item),
      objectLabel: requireTo(item),
      scope: this.factScopeFor(lifetime.until),
      temporal: this.temporalFor(lifetime.until),
      authority: evidence.authority,
      confidence: evidence.confidence,
      sourceRefs: this.sourceRefs(evidence, lifetime.source),
      observedAt: this.options.observedAt,
    };
  }

  private sourceRefs(evidence: AgentContinuityEvidenceLink, lifetimeSource?: AgentMemorySourceRecord): string[] {
    return uniqueStrings([
      ...evidence.sources.map((source) => source.uri),
      ...(lifetimeSource ? [lifetimeSource.uri] : []),
    ]);
  }

  private compileState(
    summary: string,
    model: ParsedAgentContinuityStateModel,
    statesByUri: ReadonlyMap<string, AgentContinuityStateIdentity>,
    evidence: AgentContinuityEvidenceLink,
  ): AgentContinuitySignal {
    const scope = this.ruleScopeFor(model.until);
    const identity = model.target
      ? resolveAgentContinuityStateIdentity({ referenceOrSummary: model.target, scope, statesByUri })
      : createAgentContinuitySemanticStateIdentity(summary, scope);
    return {
      scope,
      namespace: identity.namespace,
      key: identity.key,
      value: model.value,
      valueType: scalarValueType(model.value),
      authority: evidence.authority,
      confidence: evidence.confidence,
      observedAt: this.options.observedAt,
      ...(isTimestamp(model.until) ? { expiresAt: normalizeTimestamp(model.until) } : {}),
      sourceRefs: evidence.sources.map((source) => source.uri),
    };
  }

  private compileAlwaysRule(
    title: string,
    model: ParsedAgentContinuityAlwaysModel,
    evidence: AgentContinuityEvidenceLink,
  ): AgentContinuityRuleDraft {
    return {
      ...(model.target ? { targetRuleUri: model.target } : {}),
      ...(model.replace ? { replaceTarget: true } : {}),
      title,
      condition: { kind: "always" },
      action: {
        kind: "recall",
        summary: model.effect,
        activation: "while_true",
      },
      scope: this.ruleScopeFor(model.until),
      authority: evidence.authority,
      confidence: evidence.confidence,
      temporal: this.temporalFor(model.until),
      sourceRefs: evidence.sources.map((source) => source.uri),
    };
  }

  private compileConditionalRule(
    title: string,
    model: ParsedAgentContinuityConditionalModel,
    kind: "recall" | "notify",
    statesByUri: ReadonlyMap<string, AgentContinuityStateIdentity>,
    evidence: AgentContinuityEvidenceLink,
  ): AgentContinuityRuleDraft {
    const scope = this.ruleScopeFor(model.until);
    return {
      ...(model.target ? { targetRuleUri: model.target } : {}),
      ...(model.replace ? { replaceTarget: true } : {}),
      title,
      condition: compileAgentContinuityRuleCondition(model, { scope, statesByUri }),
      action: {
        kind,
        summary: model.effect,
        activation: kind === "notify" ? "once" : "while_true",
      },
      scope,
      authority: evidence.authority,
      confidence: evidence.confidence,
      temporal: this.temporalFor(model.until),
      sourceRefs: evidence.sources.map((source) => source.uri),
    };
  }

  private factScopeFor(until: string): AgentContinuityScopeRef {
    return until === "session"
      ? { kind: "session", id: this.options.recordedTurn.episode.sessionId }
      : { kind: "user", id: requireAgentContinuityIdentity(this.options.identity, "user") };
  }

  private ruleScopeFor(until: string): AgentContinuityScopeRef {
    return until === "session"
      ? { kind: "session", id: this.options.recordedTurn.episode.sessionId }
      : { kind: "workspace", id: this.options.identity.workspaceId };
  }

  private temporalFor(until: string): AgentContinuityTemporalWindow {
    return {
      kind: isTimestamp(until) ? "interval" : "persistent",
      ...(isTimestamp(until) ? { endsAt: normalizeTimestamp(until) } : {}),
      timeZone: this.timeZone,
    };
  }
}

function ruleEvidenceText(title: string, effect: string): string {
  return `${title}\n${effect}`;
}

function itemText(item: ParsedAgentContinuityCaptureItem): string {
  if (item.kind === "fact") return requireText(item);
  if (item.kind === "profile" || item.kind === "agent_profile") {
    return `${requireKey(item)}: ${JSON.stringify(requireValue(item))}`;
  }
  return `${requireFrom(item)} ${getAgentContinuityRelationDefinition(requireRelation(item)).label} ${requireTo(item)}`;
}

function requireText(item: ParsedAgentContinuityCaptureItem): string {
  if (!item.text) throw new Error("Continuity fact item is missing text.");
  return item.text;
}

function requireKey(item: ParsedAgentContinuityCaptureItem): string {
  if (!item.key) throw new Error("Continuity profile item is missing key.");
  return item.key;
}

function requireValue(item: ParsedAgentContinuityCaptureItem): string | number | boolean {
  if (item.value === undefined) throw new Error("Continuity profile item is missing value.");
  return item.value;
}

function requireFrom(item: ParsedAgentContinuityCaptureItem): string {
  if (!item.from) throw new Error("Continuity relation item is missing subject.");
  return item.from;
}

function requireRelation(item: ParsedAgentContinuityCaptureItem): string {
  if (!item.relation) throw new Error("Continuity relation item is missing relation.");
  return item.relation;
}

function requireTo(item: ParsedAgentContinuityCaptureItem): string {
  if (!item.to) throw new Error("Continuity relation item is missing object.");
  return item.to;
}

function scalarValueType(value: string | number | boolean): AgentContinuitySignal["valueType"] {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  return "boolean";
}

function normalizeTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("Continuity lifetime must use an RFC 3339 timestamp.");
  return new Date(timestamp).toISOString();
}

function isTimestamp(value: string): boolean {
  return value !== "session" && value !== "permanent";
}

function createFactId(episodeUri: string, fact: string): string {
  return `record_${crypto
    .createHash("sha256")
    .update(JSON.stringify([episodeUri, fact]))
    .digest("hex")
    .slice(0, 24)}`;
}
