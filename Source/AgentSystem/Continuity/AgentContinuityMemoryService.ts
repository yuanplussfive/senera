import { evaluateAgentContinuityRule } from "./AgentContinuityConditionEvaluator.js";
import type { AgentContinuityMemoryPromptContext, AgentContinuityRulesSnapshot } from "./AgentContinuityMemoryTypes.js";
import type { AgentContinuityObservation } from "./AgentContinuityDomain.js";
import { AgentContinuityRecordRanker, type AgentContinuityRankResult } from "./AgentContinuityRecordRanker.js";
import type { AgentContinuityConceptRecord } from "./AgentContinuityConceptCatalog.js";
import type { AgentContinuityGraphSnapshot } from "./AgentContinuityGraphTypes.js";
import { AgentContinuitySqliteStore } from "./AgentContinuitySqliteStore.js";
import {
  agentContinuityScopeKey,
  listAgentContinuityAutomaticRecallScopes,
  listAgentContinuityPromptScopes,
} from "./AgentContinuityScopes.js";
import type { AgentResidentProfileService } from "../Profile/AgentResidentProfileService.js";
import type { AgentResidentProfilePromptEntry } from "../Profile/AgentResidentProfileTypes.js";
import type { AgentMemorySourceRepository } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentMemoryDeletionImpact } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { errorMessage } from "../Core/AgentErrors.js";
import type { AgentContinuityLearningRecallConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";
import { decideAgentContinuityRecall } from "./AgentContinuityRecallGate.js";
import { agentContinuityRecallCatalogCacheKey, AgentContinuityRecallCatalog } from "./AgentContinuityRecallCatalog.js";
import {
  projectAgentContinuityEvidenceCandidates,
  projectAgentContinuityEventCandidates,
  projectAgentContinuityFactCatalog,
  countAgentContinuityProjectableFacts,
} from "./AgentContinuityMemoryProjection.js";
import {
  AgentContinuityStableSnapshotStore,
  type AgentContinuityStablePromptSnapshot,
} from "./AgentContinuityStableSnapshotStore.js";
import { applyAgentContinuityPromptBudget } from "./AgentContinuityPromptBudget.js";
import { AgentContinuitySemanticRecall } from "./AgentContinuitySemanticRecall.js";
import type { AgentContinuitySemanticRecallResult } from "./AgentContinuitySemanticRecall.js";
import { AgentContinuityTextSimilarity } from "./AgentContinuityTextSimilarity.js";
import { recallAgentContinuityGraph } from "./AgentContinuityGraphRecall.js";
import type { AgentTurnValueClassification } from "./AgentTurnValueClassifier.js";
import { AgentContinuityGraphSearchIndex } from "./AgentContinuityGraphSearchIndex.js";
import {
  createAgentContinuityRecallQueryPlan,
  projectAgentContinuityRecallQueryPlanAudit,
  type AgentContinuityRecallQueryPlan,
} from "./AgentContinuityRecallQueryPlan.js";
import { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentDomainEvent, AgentEventSink } from "../Events/AgentEventTypes.js";
import { isAgentContinuityEventRecallable } from "./AgentContinuityEventRecallPolicy.js";
import {
  combineRejections,
  countMatchedBy,
  DisabledContinuityRecallConfig,
  isSemanticUnavailable,
  projectRuleCatalog,
  projectSignal,
  semanticRecallTimeoutResult,
  stablePromptRevision,
  uniqueRankedRecords,
  withTimeout,
  isAgentContinuitySemanticTimeoutError,
  AgentContinuitySemanticTimeoutError,
  type AgentContinuityEvaluatedState,
  type SemanticRecallTimeoutResult,
} from "./AgentContinuityMemoryServiceSupport.js";
import { AgentContinuityStyleExampleIndex } from "./AgentContinuityStyleExamples.js";
import type { AgentContinuityIdentityContext } from "./AgentContinuityIdentityStore.js";
import type { AgentTemporalMemorySqliteStore } from "../TemporalMemory/AgentTemporalMemorySqliteStore.js";
import { projectAgentTemporalMemoryScope } from "../TemporalMemory/AgentTemporalMemoryIdentity.js";
import { renderAgentTemporalMemoryOverview } from "../TemporalMemory/AgentTemporalMemoryPresentation.js";
import type { AgentIdentityTemplateValues } from "../Prompt/AgentIdentityTemplate.js";
import {
  assessAgentContinuityRecallQuality,
  buildAgentContinuityContextVariant,
  buildAgentContinuityFeedbackVariant,
  deriveAgentContinuityRecallCascadeLimits,
  isAgentContinuityRecallQualityImproved,
  mergeAgentContinuityRankedRecordsByObservationUri,
  preservesAgentContinuityRecallBaseline,
  shouldExpandAgentContinuityRecall,
  type AgentContinuityRecallCascadeStage,
} from "./AgentContinuityRecallCascade.js";

export interface AgentContinuityMemoryServiceOptions {
  readonly identity: AgentContinuityIdentityContext;
  readonly store: AgentContinuitySqliteStore;
  readonly residentProfile?: AgentResidentProfileService;
  readonly sourceRepository?: AgentMemorySourceRepository;
  readonly temporalMemoryStore?: AgentTemporalMemorySqliteStore;
  /** Resolves display names only when a derived temporal summary is presented. */
  readonly identityTemplateValues?: () => AgentIdentityTemplateValues;
  readonly stableSnapshotStore?: AgentContinuityStableSnapshotStore;
  readonly recallConfig?: () => AgentContinuityLearningRecallConfig;
  /** Optional semantic channel; absent or failing leaves pure lexical ranking. */
  readonly semanticRecall?: AgentContinuitySemanticRecall;
  /** Shared local classifier used to gate low-value text recall after training. */
  readonly turnValueClassification?: (input: string) => AgentTurnValueClassification;
  readonly eventSink?: AgentEventSink;
  readonly logger?: AgentLogger;
}

/** Builds the automatic continuity context: stable profile, ranked records, event summaries, and evaluated state. */
export class AgentContinuityMemoryService {
  private readonly recallCatalog: AgentContinuityRecallCatalog;
  private readonly styleExampleIndex: AgentContinuityStyleExampleIndex;
  private rankerSnapshot: { readonly policyKey: string; readonly ranker: AgentContinuityRecordRanker } | undefined;
  private graphSearchIndexSnapshot:
    { readonly policyKey: string; readonly index: AgentContinuityGraphSearchIndex } | undefined;
  private readonly inMemoryStableSnapshots = new Map<string, AgentContinuityStablePromptSnapshot>();
  private eventSink: AgentEventSink | undefined;

  constructor(private readonly options: AgentContinuityMemoryServiceOptions) {
    this.recallCatalog = new AgentContinuityRecallCatalog(options.store, options.sourceRepository);
    this.styleExampleIndex = new AgentContinuityStyleExampleIndex(options.sourceRepository);
    this.eventSink = options.eventSink;
  }

  setEventSink(sink: AgentEventSink): void {
    this.eventSink = sink;
  }

  async promptContext(input: {
    userInput: string;
    sessionId?: string;
    requestId?: string;
  }): Promise<AgentContinuityMemoryPromptContext> {
    const scopes = listAgentContinuityPromptScopes(this.options.identity, input.sessionId);
    const automaticRecallScopes = listAgentContinuityAutomaticRecallScopes(this.options.identity, input.sessionId);
    const now = new Date();
    const recall = this.options.recallConfig?.() ?? DisabledContinuityRecallConfig;
    const recallDecision = decideAgentContinuityRecall(
      { enabled: recall.TurnValueClassifier.Enabled },
      this.options.turnValueClassification?.(input.userInput),
    );
    const concepts = this.options.store.listConcepts(scopes);
    const recallConcepts = this.options.store.listConcepts(automaticRecallScopes);
    const graph = this.options.store.graphSnapshot(scopes);
    const recallGraph = this.options.store.graphSnapshot(automaticRecallScopes);
    const textSimilarity = new AgentContinuityTextSimilarity(recall.Ranking.Similarity);
    const cacheTtlMs = recall.Prefetch.Enabled ? recall.Prefetch.CacheTtlSeconds * 1_000 : 0;
    const catalog = recallDecision.shouldRecallText
      ? this.recallCatalog.read(automaticRecallScopes, {
          nowMs: now.getTime(),
          cacheTtlMs,
          identity: this.options.identity,
          sessionId: input.sessionId,
        })
      : undefined;
    const observations = catalog?.observations ?? [];
    const eventObservations = (catalog?.eventObservations ?? []).filter(isAgentContinuityEventRecallable);
    const factHeads = this.options.store.listFactHeads(automaticRecallScopes, now);
    const factValidUntilByObservationUri = new Map(
      factHeads.map((fact) => [fact.observationUri, fact.validUntil ?? null] as const),
    );
    const ranker = this.rankerFor(recall.Ranking);
    const rankOptions = {
      sessionId: input.sessionId,
      now,
      cacheTtlMs,
      catalogRevision: catalog?.revision,
      catalogKey: catalog?.cacheKey,
    };
    const rankSession = ranker.openSession({
      observations,
      eventObservations,
      ...rankOptions,
      factValidUntilByObservationUri,
    });
    const queryPlan = recallDecision.shouldRecallText
      ? this.createQueryPlan({
          query: input.userInput,
          concepts: recallConcepts,
          graph: recallGraph,
          similarity: textSimilarity,
          now,
          cacheTtlMs,
          ranking: recall.Ranking,
          maxRelationMatches: recall.PromptBudget.MaxRelationEntries,
          maxGraphHops: recall.Ranking.Graph.MaxHops,
        })
      : undefined;
    const recallQuery = queryPlan?.expandedQuery ?? input.userInput;
    const recallStartedAt = Date.now();
    const adaptiveLimits = deriveAgentContinuityRecallCascadeLimits(recall.Ranking, recall.PromptBudget);
    const lexicalQueries = [recallQuery];
    const adaptiveStages: AgentContinuityRecallCascadeStage[] = [];
    const rankLocal = (queries: readonly string[], semanticScores?: ReadonlyMap<string, number>) => ({
      learning: rankSession.rank({
        query: input.userInput,
        lexicalQuery: recallQuery,
        lexicalQueries: queries,
        directQuery: input.userInput,
        semanticScores,
      }),
      events: rankSession.rankEvents({
        query: input.userInput,
        lexicalQuery: recallQuery,
        lexicalQueries: queries,
        semanticScores,
      }),
    });

    let rankingResult: AgentContinuityRankResult | undefined;
    let eventRankingResult: AgentContinuityRankResult | undefined;
    let semanticResult: AgentContinuitySemanticRecallResult | SemanticRecallTimeoutResult | undefined;
    if (recallDecision.shouldRecallText) {
      ({ learning: rankingResult, events: eventRankingResult } = rankLocal(lexicalQueries));
      let quality = assessAgentContinuityRecallQuality([rankingResult, eventRankingResult], {
        minimumTextSimilarityScore: recall.Ranking.MinimumTextSimilarityScore,
      });
      adaptiveStages.push({ source: "baseline", triggered: true, addedTerms: 0, quality });

      const hasQuery = input.userInput.trim().length > 0;
      if (hasQuery && shouldExpandAgentContinuityRecall(quality, recall.Ranking)) {
        const contextVariant = buildAgentContinuityContextVariant({
          query: input.userInput,
          contexts: this.recallContextTexts(
            input.sessionId,
            eventObservations,
            adaptiveLimits.maxSeedRecords,
            adaptiveLimits.maxCharacters,
          ),
          similarity: textSimilarity,
          vocabulary: rankSession.lexicalVocabulary("combined"),
          maxTerms: adaptiveLimits.maxTerms,
          maxCharacters: adaptiveLimits.maxCharacters,
        });
        if (contextVariant) {
          const candidateQueries = [...lexicalQueries, contextVariant.query];
          const candidate = rankLocal(candidateQueries);
          const candidateQuality = assessAgentContinuityRecallQuality([candidate.learning, candidate.events], {
            minimumTextSimilarityScore: recall.Ranking.MinimumTextSimilarityScore,
          });
          adaptiveStages.push({
            source: "context",
            triggered: true,
            addedTerms: contextVariant.addedTerms.length,
            quality: candidateQuality,
          });
          if (
            isAgentContinuityRecallQualityImproved(candidateQuality, quality) &&
            preservesAgentContinuityRecallBaseline(
              [rankingResult, eventRankingResult],
              [candidate.learning, candidate.events],
              recall.Ranking.MinimumTextSimilarityScore,
            )
          ) {
            lexicalQueries.push(contextVariant.query);
            ({ learning: rankingResult, events: eventRankingResult } = candidate);
            quality = candidateQuality;
          }
        } else {
          adaptiveStages.push({ source: "context", triggered: false, addedTerms: 0, quality });
        }
      }

      if (
        adaptiveStages.filter((stage) => stage.triggered && stage.source !== "baseline").length <
        adaptiveLimits.maxStages
      ) {
        if (hasQuery && shouldExpandAgentContinuityRecall(quality, recall.Ranking)) {
          const feedbackVariant = buildAgentContinuityFeedbackVariant({
            query: input.userInput,
            seeds: mergeAgentContinuityRankedRecordsByObservationUri([
              ...(rankingResult?.records ?? []),
              ...(eventRankingResult?.records ?? []),
            ]),
            corpus: mergeRecallFeedbackCorpus(observations, eventObservations),
            similarity: textSimilarity,
            vocabulary: rankSession.lexicalVocabulary("combined"),
            maxSeedRecords: adaptiveLimits.maxSeedRecords,
            maxTerms: adaptiveLimits.maxTerms,
            maxCharacters: adaptiveLimits.maxCharacters,
            minSeedScore: adaptiveLimits.minSeedScore,
          });
          if (feedbackVariant) {
            const candidateQueries = [...lexicalQueries, feedbackVariant.query];
            const candidate = rankLocal(candidateQueries);
            const candidateQuality = assessAgentContinuityRecallQuality([candidate.learning, candidate.events], {
              minimumTextSimilarityScore: recall.Ranking.MinimumTextSimilarityScore,
            });
            adaptiveStages.push({
              source: "feedback",
              triggered: true,
              addedTerms: feedbackVariant.addedTerms.length,
              quality: candidateQuality,
            });
            if (
              isAgentContinuityRecallQualityImproved(candidateQuality, quality) &&
              preservesAgentContinuityRecallBaseline(
                [rankingResult, eventRankingResult],
                [candidate.learning, candidate.events],
                recall.Ranking.MinimumTextSimilarityScore,
              )
            ) {
              lexicalQueries.push(feedbackVariant.query);
              ({ learning: rankingResult, events: eventRankingResult } = candidate);
              quality = candidateQuality;
            }
          } else {
            adaptiveStages.push({ source: "feedback", triggered: false, addedTerms: 0, quality });
          }
        }
      }

      // Embeddings remain an optional final stage and always receive the raw
      // request. Local graph/context terms must never alter vector meaning.
      if (hasQuery && recall.Semantic.Enabled && shouldExpandAgentContinuityRecall(quality, recall.Ranking)) {
        semanticResult = await this.awaitSemanticScores(recall, input.userInput, observations, eventObservations);
        const candidate = rankLocal(lexicalQueries, semanticResult?.scores);
        const candidateQuality = assessAgentContinuityRecallQuality([candidate.learning, candidate.events], {
          minimumTextSimilarityScore: recall.Ranking.MinimumTextSimilarityScore,
        });
        adaptiveStages.push({ source: "semantic", triggered: true, addedTerms: 0, quality: candidateQuality });
        if (
          isAgentContinuityRecallQualityImproved(candidateQuality, quality) &&
          preservesAgentContinuityRecallBaseline(
            [rankingResult, eventRankingResult],
            [candidate.learning, candidate.events],
            recall.Ranking.MinimumTextSimilarityScore,
          )
        ) {
          ({ learning: rankingResult, events: eventRankingResult } = candidate);
        }
      } else {
        adaptiveStages.push({ source: "semantic", triggered: false, addedTerms: 0, quality });
      }
      if (recall.Prefetch.Enabled || adaptiveStages.some((stage) => stage.source === "semantic" && stage.triggered)) {
        this.scheduleSemanticIndex(recall, observations, eventObservations);
      }
    }
    const ranked = rankingResult ? uniqueRankedRecords(rankingResult.records) : [];
    const rankedEvents = eventRankingResult
      ? mergeAgentContinuityRankedRecordsByObservationUri(eventRankingResult.records)
      : [];
    this.emitRecallEvents({
      sessionId: input.sessionId,
      requestId: input.requestId,
      recallStartedAt,
      rankingResult,
      eventRankingResult,
      semanticResult,
      recall,
      originalQuery: input.userInput,
      queryPlan,
      adaptiveStages,
    });
    const state = this.evaluateState(scopes, now, true);
    const graphRecall = recallDecision.shouldRecallText
      ? recallAgentContinuityGraph({
          query: input.userInput,
          relations: recallGraph.relations,
          entities: recallGraph.entities,
          anchorUris: queryPlan?.anchorUris,
          preferredRelationIds: queryPlan?.relationMatches
            .filter((match) => match.direct && match.score >= recall.Ranking.DirectTextSimilarityScore)
            .map((match) => match.relationId),
          similarity: textSimilarity,
          now,
          minimumScore: recall.Ranking.CandidateScore,
          maxEntries: recall.PromptBudget.MaxRelationEntries,
          maxHops: recall.Ranking.Graph.MaxHops,
        })
      : { relations: [], matchedRelationUris: [] };
    const residentProfile = this.options.residentProfile?.promptContext(scopes, now) ?? [];
    const factCatalog = projectAgentContinuityFactCatalog(factHeads, {
      residentProfile,
      rankedRecords: ranked,
    });
    const stableSnapshot = this.stablePromptSnapshot({
      sessionId: input.sessionId,
      residentProfile,
      revision: stablePromptRevision(residentProfile),
      createdAt: now.toISOString(),
    });
    const evidenceCandidates = projectAgentContinuityEvidenceCandidates(ranked);
    const eventCandidates = projectAgentContinuityEventCandidates(rankedEvents);
    const styleExamples = recallDecision.shouldRecallText
      ? this.styleExampleIndex.select({
          sessionId: input.sessionId,
          query: input.userInput,
          maxEntries: recall.PromptBudget.MaxEventEntries,
          similarity: recall.Ranking.Similarity,
          minimumScore: recall.Ranking.MinimumTextSimilarityScore,
        })
      : { examples: [], available: 0, matched: 0 };
    const budgeted = applyAgentContinuityPromptBudget(
      {
        profiles: stableSnapshot.residentProfile,
        facts: factCatalog,
        relations: graphRecall.relations,
        events: eventCandidates,
        evidence: evidenceCandidates,
        styleExamples: styleExamples.examples,
        availableFactCount: countAgentContinuityProjectableFacts(factHeads, residentProfile),
        availableRelationCount: recallGraph.relations.length,
        availableEventCount: eventObservations.length,
      },
      recall.PromptBudget,
    );
    const temporalOverview = this.options.temporalMemoryStore?.overview(
      projectAgentTemporalMemoryScope(this.options.identity).key,
    ) ?? {
      counts: [],
      segmentDecisions: [],
      latestSealed: [],
    };
    const temporalMemory = this.options.identityTemplateValues
      ? renderAgentTemporalMemoryOverview(temporalOverview, this.options.identityTemplateValues())
      : temporalOverview;
    return {
      enabled: true,
      concepts,
      graph,
      graphRelations: budgeted.relations,
      temporalMemory,
      residentProfile: budgeted.profiles,
      factCatalog: budgeted.facts,
      selection: budgeted.selection,
      rejections: combineRejections(rankingResult?.rejections, eventRankingResult?.rejections),
      nearMisses: (rankingResult?.nearMisses ?? []).map((nearMiss) => ({
        summary: nearMiss.observation.summary,
        score: nearMiss.score,
        textSimilarityScore: nearMiss.textSimilarityScore,
        lexicalScore: nearMiss.lexicalScore,
        semanticScore: nearMiss.semanticScore,
        matchedBy: [...nearMiss.matchedBy],
      })),
      pendingRuleDeliveryUris: state.evaluatedRules
        .filter(
          ({ rule, evaluation, shouldProject }) =>
            shouldProject &&
            evaluation.status === "triggered" &&
            rule.action.activation === "once" &&
            !rule.lastTriggeredAt,
        )
        .map(({ rule }) => rule.uri),
      evidenceCandidates: budgeted.evidence,
      eventCandidates: budgeted.events,
      styleExamples: budgeted.styleExamples,
      activeRules: state.evaluatedRules
        .filter(({ shouldProject }) => shouldProject)
        .map(({ rule, evaluation }) => ({
          title: rule.title,
          action: rule.action.summary,
          status: evaluation.status === "triggered" ? ("triggered" as const) : ("partial" as const),
          missingSignals: evaluation.missingSignals,
        })),
      ruleCatalog: projectRuleCatalog(state.evaluatedRules),
      signals: state.signals.map(projectSignal),
    };
  }

  /** Warms deterministic indexes and schedules semantic backfill without delaying the caller. */
  prefetch(input: { sessionId?: string } = {}): void {
    const recall = this.options.recallConfig?.() ?? DisabledContinuityRecallConfig;
    if (!recall.Prefetch.Enabled) return;
    const scopes = listAgentContinuityAutomaticRecallScopes(this.options.identity, input.sessionId);
    const now = new Date();
    const catalog = this.recallCatalog.read(scopes, {
      nowMs: now.getTime(),
      cacheTtlMs: recall.Prefetch.CacheTtlSeconds * 1_000,
      identity: this.options.identity,
      sessionId: input.sessionId,
    });
    this.scheduleSemanticIndex(recall, catalog.observations, catalog.eventObservations);
    this.rankerFor(recall.Ranking).warm({
      observations: catalog.observations,
      eventObservations: catalog.eventObservations.filter(isAgentContinuityEventRecallable),
      cacheTtlMs: recall.Prefetch.CacheTtlSeconds * 1_000,
      now,
      catalogRevision: catalog.revision,
      catalogKey: catalog.cacheKey,
    });
    this.graphSearchIndexFor(recall.Ranking).warm({
      concepts: this.options.store.listConcepts(scopes),
      graph: this.options.store.graphSnapshot(scopes),
      nowMs: now.getTime(),
      cacheTtlMs: recall.Prefetch.CacheTtlSeconds * 1_000,
    });
  }

  rulesSnapshot(input: { sessionId?: string; now?: Date } = {}): AgentContinuityRulesSnapshot {
    const scopes = listAgentContinuityPromptScopes(this.options.identity, input.sessionId);
    const state = this.evaluateState(scopes, input.now ?? new Date(), false);
    return {
      rules: projectRuleCatalog(state.evaluatedRules),
      signals: state.signals.map(projectSignal),
    };
  }

  acknowledgeRuleDeliveries(ruleUris: readonly string[], deliveredAt: string): number {
    return this.options.store.acknowledgeRuleDeliveries(ruleUris, deliveredAt);
  }

  deleteSession(sessionId: string): void {
    this.clearRecallCaches(sessionId);
    this.inMemoryStableSnapshots.delete(sessionId);
    this.options.stableSnapshotStore?.deleteSession(sessionId);
    this.styleExampleIndex.clear(sessionId);
    this.recallCatalog.clearPhysical();
  }

  deleteSources(impact: AgentMemoryDeletionImpact): void {
    this.clearRecallCaches(impact.sessionId);
    this.inMemoryStableSnapshots.delete(impact.sessionId);
    this.options.stableSnapshotStore?.deleteSession(impact.sessionId);
    this.styleExampleIndex.clear(impact.sessionId);
    this.recallCatalog.clearPhysical();
  }

  private clearRecallCaches(sessionId: string): void {
    const scopeKeys = new Set([
      agentContinuityScopeKey(listAgentContinuityPromptScopes(this.options.identity, sessionId)),
      agentContinuityScopeKey(listAgentContinuityAutomaticRecallScopes(this.options.identity, sessionId)),
    ]);
    for (const scopeKey of scopeKeys) {
      this.recallCatalog.clear(scopeKey);
      this.graphSearchIndexSnapshot?.index.clear(scopeKey);
    }
    this.rankerSnapshot?.ranker.clear(
      agentContinuityRecallCatalogCacheKey(
        agentContinuityScopeKey(listAgentContinuityAutomaticRecallScopes(this.options.identity, sessionId)),
        { identity: this.options.identity, sessionId },
      ),
    );
  }

  private stablePromptSnapshot(input: {
    readonly sessionId?: string;
    readonly revision: string;
    readonly residentProfile: readonly AgentResidentProfilePromptEntry[];
    readonly createdAt: string;
  }): AgentContinuityStablePromptSnapshot {
    if (!input.sessionId) {
      return {
        sessionId: "",
        revision: input.revision,
        residentProfile: input.residentProfile,
        createdAt: input.createdAt,
      };
    }
    const persisted = this.options.stableSnapshotStore?.read(input.sessionId);
    if (persisted?.revision === input.revision) return persisted;
    const existing = this.inMemoryStableSnapshots.get(input.sessionId);
    if (existing?.revision === input.revision) return existing;
    const saved = this.options.stableSnapshotStore?.save({
      sessionId: input.sessionId,
      revision: input.revision,
      residentProfile: input.residentProfile,
      createdAt: input.createdAt,
    }) ?? {
      sessionId: input.sessionId,
      revision: input.revision,
      residentProfile: input.residentProfile,
      createdAt: input.createdAt,
    };
    this.inMemoryStableSnapshots.set(input.sessionId, saved);
    return saved;
  }

  private rankerFor(policy: AgentContinuityLearningRecallConfig["Ranking"]): AgentContinuityRecordRanker {
    const key = JSON.stringify(policy);
    if (this.rankerSnapshot?.policyKey === key) return this.rankerSnapshot.ranker;
    const ranker = new AgentContinuityRecordRanker(policy);
    this.rankerSnapshot = { policyKey: key, ranker };
    return ranker;
  }

  private graphSearchIndexFor(policy: AgentContinuityLearningRecallConfig["Ranking"]): AgentContinuityGraphSearchIndex {
    const key = JSON.stringify({ Similarity: policy.Similarity, Lexical: policy.Lexical });
    if (this.graphSearchIndexSnapshot?.policyKey === key) return this.graphSearchIndexSnapshot.index;
    const index = new AgentContinuityGraphSearchIndex(
      new AgentContinuityTextSimilarity(policy.Similarity),
      policy.Lexical,
    );
    this.graphSearchIndexSnapshot = { policyKey: key, index };
    return index;
  }

  /**
   * Returns grounded lexical context for the adaptive stage. Only the open
   * segment focus and prior user turns are used; assistant prose is never
   * copied into a query expansion surface.
   */
  private recallContextTexts(
    sessionId: string | undefined,
    eventObservations: readonly AgentContinuityObservation[],
    maxContexts: number,
    maxCharacters: number,
  ): readonly string[] {
    const contexts: string[] = [];
    if (sessionId && this.options.temporalMemoryStore) {
      const scope = projectAgentTemporalMemoryScope(this.options.identity);
      const focus = this.options.temporalMemoryStore.openSegment(scope.key, sessionId)?.workingFocus.trim();
      if (focus) contexts.push(focus);
    }
    contexts.push(
      ...eventObservations
        .filter((observation) => observation.kind === "conversation.user_message")
        .sort((left, right) => right.createdAtMs - left.createdAtMs)
        .slice(0, maxContexts)
        .map((observation) => observation.summary.trim().slice(0, maxCharacters))
        .filter(Boolean),
    );
    return contexts.slice(0, maxContexts + 1);
  }

  private scheduleSemanticIndex(
    recall: AgentContinuityLearningRecallConfig,
    observations: readonly AgentContinuityObservation[],
    eventObservations: readonly AgentContinuityObservation[],
  ): void {
    if (!this.options.semanticRecall || !recall.Semantic.Enabled) return;
    void this.options.semanticRecall.embedObservations([...observations, ...eventObservations]).catch((error) => {
      this.options.logger?.warn("continuity.semantic.prefetch_failed", {
        message: errorMessage(error),
      });
    });
  }

  private createQueryPlan(input: {
    readonly query: string;
    readonly concepts: readonly AgentContinuityConceptRecord[];
    readonly graph: AgentContinuityGraphSnapshot;
    readonly similarity: AgentContinuityTextSimilarity;
    readonly now: Date;
    readonly cacheTtlMs: number;
    readonly ranking: AgentContinuityLearningRecallConfig["Ranking"];
    readonly maxRelationMatches: number;
    readonly maxGraphHops: number;
  }): AgentContinuityRecallQueryPlan {
    const candidates = this.graphSearchIndexFor(input.ranking).select({
      query: input.query,
      concepts: input.concepts,
      graph: input.graph,
      nowMs: input.now.getTime(),
      cacheTtlMs: input.cacheTtlMs,
      maxConcepts: input.ranking.Funnel.MaxLexicalCandidates,
      maxEntities: input.ranking.Funnel.MaxLexicalCandidates,
    });
    return createAgentContinuityRecallQueryPlan({
      query: input.query,
      concepts: input.concepts,
      graph: input.graph,
      similarity: input.similarity,
      now: input.now,
      minimumScore: input.ranking.MinimumTextSimilarityScore,
      directScore: input.ranking.DirectTextSimilarityScore,
      maxConceptMatches: input.ranking.Funnel.MaxLexicalCandidates,
      maxEntityMatches: input.ranking.Funnel.MaxLexicalCandidates,
      maxRelationMatches: input.maxRelationMatches,
      anchorPolicy: input.ranking.Anchor,
      candidates,
    });
  }

  private async awaitSemanticScores(
    recall: AgentContinuityLearningRecallConfig,
    recallQuery: string,
    observations: readonly AgentContinuityObservation[],
    eventObservations: readonly AgentContinuityObservation[],
  ): Promise<AgentContinuitySemanticRecallResult | SemanticRecallTimeoutResult | undefined> {
    const semantic = this.options.semanticRecall;
    if (!semantic || !recall.Semantic.Enabled) return undefined;
    const timeoutController = new AbortController();
    try {
      return await withTimeout(
        semantic.queryScoresDetailed(recallQuery, [...observations, ...eventObservations], {
          minQueryCharacters: recall.Semantic.MinQueryCharacters,
          signal: timeoutController.signal,
        }),
        recall.Semantic.TimeoutMs,
        () => timeoutController.abort(new AgentContinuitySemanticTimeoutError()),
      );
    } catch (error) {
      if (isAgentContinuitySemanticTimeoutError(error)) {
        return semanticRecallTimeoutResult();
      }
      this.options.logger?.warn("continuity.recall.semantic_failed", {
        message: errorMessage(error),
      });
      return {
        status: "request_failed" as const,
        scores: new Map(),
        indexedCount: 0,
        compatibleCount: 0,
      };
    }
  }

  private emitRecallEvents(input: {
    sessionId?: string;
    requestId?: string;
    recallStartedAt: number;
    rankingResult?: AgentContinuityRankResult;
    eventRankingResult?: AgentContinuityRankResult;
    semanticResult: AgentContinuitySemanticRecallResult | SemanticRecallTimeoutResult | undefined;
    recall: AgentContinuityLearningRecallConfig;
    originalQuery: string;
    queryPlan: AgentContinuityRecallQueryPlan | undefined;
    adaptiveStages: readonly AgentContinuityRecallCascadeStage[];
  }): void {
    const sink = this.eventSink;
    if (!sink || !input.sessionId || !input.requestId) return;
    const context = { sessionId: input.sessionId, requestId: input.requestId };
    const degraded =
      input.semanticResult?.status === "timeout"
        ? "semantic_timeout"
        : input.semanticResult && isSemanticUnavailable(input.semanticResult.status)
          ? "semantic_unavailable"
          : "none";
    const queryData = {
      original: input.originalQuery,
      ...(input.queryPlan ? { local: projectAgentContinuityRecallQueryPlanAudit(input.queryPlan) } : {}),
    };
    void this.emit(sink, {
      kind: AgentEventKinds.ContinuityRecallQuery,
      context,
      data: queryData,
    });
    const matchedByCounts = countMatchedBy(input.rankingResult, input.eventRankingResult);
    const allRankedRecords = mergeAgentContinuityRankedRecordsByObservationUri([
      ...(input.rankingResult?.records ?? []),
      ...(input.eventRankingResult?.records ?? []),
    ]);
    const eventRankedRecords = mergeAgentContinuityRankedRecordsByObservationUri(
      input.eventRankingResult?.records ?? [],
    );
    const nearMissUris = new Set(
      [...(input.rankingResult?.nearMisses ?? []), ...(input.eventRankingResult?.nearMisses ?? [])].map(
        (record) => record.observation.uri,
      ),
    );
    void this.emit(sink, {
      kind: AgentEventKinds.ContinuityRecallSettled,
      context,
      data: {
        injectedCount: allRankedRecords.length,
        eventCount: eventRankedRecords.length,
        matchedByCounts,
        directCount: allRankedRecords.filter((record) => record.projection === "direct").length,
        referenceCount: allRankedRecords.filter((record) => record.projection === "reference").length,
        nearMissCount: nearMissUris.size,
        belowSimilarity:
          (input.rankingResult?.rejections.belowSimilarity ?? 0) +
          (input.eventRankingResult?.rejections.belowSimilarity ?? 0),
        belowCandidate:
          (input.rankingResult?.rejections.belowCandidate ?? 0) +
          (input.eventRankingResult?.rejections.belowCandidate ?? 0),
        funnelSkipped:
          (input.rankingResult?.rejections.funnelSkipped ?? 0) +
          (input.eventRankingResult?.rejections.funnelSkipped ?? 0),
        degraded,
        semanticStatus: input.semanticResult?.status ?? (input.recall.Semantic.Enabled ? "unavailable" : "disabled"),
        semanticIndexedCount: input.semanticResult?.indexedCount ?? 0,
        semanticCompatibleCount: input.semanticResult?.compatibleCount ?? 0,
        adaptiveStages: input.adaptiveStages.map((stage) => ({
          source: stage.source,
          triggered: stage.triggered,
          addedTerms: stage.addedTerms,
          acceptedCount: stage.quality.acceptedCount,
          candidateCount: stage.quality.candidateCount,
          topScore: stage.quality.topScore,
          topMargin: stage.quality.topMargin,
        })),
        totalLatencyMs: Date.now() - input.recallStartedAt,
      },
    });
  }

  private emit(sink: AgentEventSink, event: AgentDomainEvent): void {
    const context = event.context as { readonly sessionId?: string; readonly requestId?: string };
    void Promise.resolve(sink(event)).catch((error) => {
      this.options.logger?.warn("continuity.recall.event_publish_failed", {
        eventKind: event.kind,
        sessionId: context.sessionId,
        requestId: context.requestId,
        message: errorMessage(error),
      });
    });
  }

  private evaluateState(
    scopes: ReturnType<typeof listAgentContinuityPromptScopes>,
    now: Date,
    persistEvaluation: boolean,
  ): AgentContinuityEvaluatedState {
    const signals = this.options.store.listSignals(scopes, now);
    const evaluatedRules = this.options.store.listRules(scopes).map((rule) => {
      const evaluation = evaluateAgentContinuityRule(rule, signals, now);
      const terminal = rule.status === "cancelled" || rule.status === "resolved";
      const storedRule =
        terminal || !persistEvaluation
          ? rule
          : this.options.store.updateRuleEvaluation(rule, evaluation.status, now.toISOString());
      const shouldProject =
        rule.maturity !== "candidate" &&
        (evaluation.status === "partial" ||
          (evaluation.status === "triggered" && (rule.action.activation === "while_true" || !rule.lastTriggeredAt)));
      return { rule: storedRule, evaluation, shouldProject };
    });
    return { signals, evaluatedRules };
  }
}

/** Feedback statistics must see the same fact and physical-event surface as ranking. */
function mergeRecallFeedbackCorpus(
  learning: readonly AgentContinuityObservation[],
  events: readonly AgentContinuityObservation[],
): readonly AgentContinuityObservation[] {
  const records = new Map<string, AgentContinuityObservation>();
  for (const observation of [...learning, ...events]) {
    const current = records.get(observation.uri);
    if (!current || observationTextLength(observation) > observationTextLength(current)) {
      records.set(observation.uri, observation);
    }
  }
  return [...records.values()];
}

function observationTextLength(observation: AgentContinuityObservation): number {
  return observation.summary.length + (observation.searchText?.length ?? 0);
}
