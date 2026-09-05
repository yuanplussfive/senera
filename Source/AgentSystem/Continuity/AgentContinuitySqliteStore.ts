import type Database from "better-sqlite3";
import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../Memory/AgentMemorySqlSchema.js";
import type { AgentMemoryDeletionImpact } from "../Memory/AgentMemorySourceRepository.js";
import type { ResolvedAgentContinuityRecallRankingConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";
import type { AgentUpgradeSession } from "../Upgrade/AgentUpgradeSession.js";
import type {
  AgentContinuityObservation,
  AgentContinuityRule,
  AgentContinuityRuleStatus,
  AgentContinuityScopeRef,
  AgentContinuitySignal,
} from "./AgentContinuityDomain.js";
import {
  continuityObservationCatalogRevision,
  listAgentContinuityEventObservations,
  listAgentContinuityFactHeads,
  listAgentContinuityFactHistory,
  listAgentContinuityLearningObservations,
  recordAgentContinuityObservation,
} from "./AgentContinuitySqliteFacts.js";
import { deleteAgentContinuitySession, deleteAgentContinuitySources } from "./AgentContinuitySqliteCleanup.js";
import {
  claimAgentContinuityLearningJob,
  completeAgentContinuityFactLearning,
  completeAgentContinuityRuleLearning,
  deferAgentContinuityFactJobsForSession,
  enqueueAgentContinuityLearning,
  failAgentContinuityLearningJob,
  listDueAgentContinuityLearningJobs,
  nextAgentContinuityLearningDueAtMs,
  recoverAgentContinuityInterruptedLearningJobs,
  releaseAgentContinuityPendingLearningJobs,
  type AgentContinuityLearningPersistence,
} from "./AgentContinuitySqliteLearningJobs.js";
import {
  acknowledgeAgentContinuityRuleDeliveries,
  listAgentContinuityLiveRules,
  listAgentContinuityRules,
  recordAgentContinuityRule,
  reconcileLegacyAgentContinuityRules,
  updateAgentContinuityRuleEvaluation,
} from "./AgentContinuitySqliteRules.js";
import { listAgentContinuitySignals, upsertAgentContinuitySignal } from "./AgentContinuitySqliteSignals.js";
import {
  listAgentContinuityTurnValueExamples,
  pruneAgentContinuityTurnValueExamples,
  recordAgentContinuityTurnValueExample,
  type AgentContinuityTurnValueExample,
} from "./AgentContinuityTurnValueExamples.js";
import {
  listAgentContinuityObservationEmbeddings,
  pruneAgentContinuityObservationEmbeddings,
  upsertAgentContinuityObservationEmbeddings,
  type AgentContinuityObservationEmbedding,
} from "./AgentContinuitySqliteEmbeddings.js";
import {
  createAgentContinuityFactReconciliationPolicy,
  reconcileAgentContinuityFacts,
  reconcileAllAgentContinuityFacts,
  type AgentContinuityFactReconciliationPolicy,
  type AgentContinuityFactReconciliationResult,
} from "./AgentContinuityFactReconciliation.js";
import type {
  AgentContinuityFactHead,
  AgentContinuityFactHistoryEntry,
  AgentContinuityFactLearningResult,
  AgentContinuityLearningClaim,
  AgentContinuityLearningClaimTransition,
  AgentContinuityLearningJob,
  AgentContinuityLearningStage,
  AgentContinuityRuleDraft,
  AgentContinuityRuleLearningResult,
} from "./AgentContinuitySqliteTypes.js";
import {
  AgentContinuityRuleConsolidationDefaults,
  type AgentContinuityRuleConsolidationPolicy,
} from "./AgentContinuityRuleConsolidationPolicy.js";
import {
  correctAgentContinuityConcept,
  ensureAgentContinuityConcept,
  listAgentContinuityConcepts,
  mergeAgentContinuityConcepts,
  purgeAgentContinuitySignalConcepts,
  renameAgentContinuityConcept,
  splitAgentContinuityConcept,
  type AgentContinuityConceptCorrectionInput,
  type AgentContinuityConceptMergeInput,
  type AgentContinuityConceptRecord,
  type AgentContinuityConceptRenameInput,
  type AgentContinuityConceptSplitInput,
} from "./AgentContinuityConceptCatalog.js";
import { AgentContinuityEntityAliasResolver } from "./AgentContinuityEntityAliasResolver.js";
import { resolveAgentContinuityRelationEndpointKinds } from "./AgentContinuityRelationCatalog.js";
import { AgentContinuityTextSimilarity } from "./AgentContinuityTextSimilarity.js";
import { agentContinuityScopeKey } from "./AgentContinuityScopes.js";
import {
  continuityGraphCatalogRevision,
  listAgentContinuityGraphNeighbors,
  listAgentContinuityGraphRelations,
  recordAgentContinuityGraphRelation,
  snapshotAgentContinuityGraph,
} from "./AgentContinuitySqliteGraph.js";
import type {
  AgentContinuityGraphRelation,
  AgentContinuityGraphRelationCandidate,
  AgentContinuityGraphRelationDraft,
  AgentContinuityGraphRelationQuery,
  AgentContinuityGraphSnapshot,
} from "./AgentContinuityGraphTypes.js";
import {
  listAgentContinuityLearningInferences,
  readAgentContinuityLearningInference,
  recordAgentContinuityLearningInference,
  type AgentContinuityLearningInferenceRecord,
  type AgentContinuityLearningInferenceWrite,
} from "./AgentContinuityLearningInferenceStore.js";

export type {
  AgentContinuityFactHead,
  AgentContinuityFactHistoryEntry,
  AgentContinuityFactLearningResult,
  AgentContinuityLearningJob,
  AgentContinuityLearningStage,
  AgentContinuityLearningStageStatus,
  AgentContinuityRuleDraft,
  AgentContinuityRuleLearningResult,
} from "./AgentContinuitySqliteTypes.js";
export type {
  AgentContinuityConceptCorrectionInput,
  AgentContinuityConceptMergeInput,
  AgentContinuityConceptRecord,
  AgentContinuityConceptRenameInput,
  AgentContinuityConceptSplitInput,
} from "./AgentContinuityConceptCatalog.js";
export type {
  AgentContinuityGraphEntity,
  AgentContinuityGraphRelation,
  AgentContinuityGraphRelationCandidate,
  AgentContinuityGraphRelationDraft,
  AgentContinuityGraphRelationEvidence,
  AgentContinuityGraphRelationQuery,
  AgentContinuityGraphSnapshot,
} from "./AgentContinuityGraphTypes.js";

export interface AgentContinuitySqliteStoreOptions {
  /**
   * Resolved on every fact write so recall-ranking edits apply without
   * re-opening the database; defaults to the built-in ranking policy.
   */
  readonly factReconciliationPolicy?: () => ResolvedAgentContinuityRecallRankingConfig;
  /** Resolved once per write/rebuild so all evidence-backed heads mature consistently. */
  readonly consolidationPolicy?: () => AgentContinuityRuleConsolidationPolicy;
}

/** Stable public facade over the continuity SQLite repositories. */
export class AgentContinuitySqliteStore {
  private readonly kernel: AgentSqliteDatabaseKernel;
  private readonly ownsKernel: boolean;
  private readonly db: Database.Database;
  private readonly factReconciliationPolicy?: () => ResolvedAgentContinuityRecallRankingConfig;
  private readonly consolidationPolicy?: () => AgentContinuityRuleConsolidationPolicy;
  private readonly entityAliasResolver = new AgentContinuityEntityAliasResolver();
  private readonly graphSnapshots = new Map<
    string,
    { readonly revision: number; readonly snapshot: AgentContinuityGraphSnapshot }
  >();

  constructor(
    database: string | AgentSqliteDatabaseKernel,
    upgradeSession?: AgentUpgradeSession,
    options?: AgentContinuitySqliteStoreOptions,
  ) {
    this.ownsKernel = typeof database === "string";
    this.kernel =
      typeof database === "string"
        ? new AgentSqliteDatabaseKernel({
            databasePath: database,
            contract: AgentMemoryDatabaseContract,
            upgradeSession,
          })
        : database;
    this.db = this.kernel.connection;
    this.factReconciliationPolicy = options?.factReconciliationPolicy;
    this.consolidationPolicy = options?.consolidationPolicy;
    reconcileLegacyAgentContinuityRules(this.db, new Date().toISOString(), this.consolidation(), this.ruleSimilarity());
    purgeAgentContinuitySignalConcepts(this.db);
  }

  recordObservation(input: AgentContinuityObservation): AgentContinuityObservation {
    const observation = recordAgentContinuityObservation(this.db, input, this.factReconciliation());
    this.invalidateGraphSnapshots();
    return observation;
  }

  reconcileFacts(
    scopes: readonly AgentContinuityScopeRef[],
    now = new Date(),
  ): AgentContinuityFactReconciliationResult {
    const result = reconcileAgentContinuityFacts(this.db, scopes, this.factReconciliation(), now.toISOString());
    this.invalidateGraphSnapshots();
    return result;
  }

  reconcileAllFacts(now = new Date()): AgentContinuityFactReconciliationResult {
    const result = reconcileAllAgentContinuityFacts(this.db, this.factReconciliation(), now.toISOString());
    this.invalidateGraphSnapshots();
    return result;
  }

  private factReconciliation(): AgentContinuityFactReconciliationPolicy {
    return createAgentContinuityFactReconciliationPolicy(this.factReconciliationPolicy?.());
  }

  private consolidation(): AgentContinuityRuleConsolidationPolicy {
    return this.consolidationPolicy?.() ?? AgentContinuityRuleConsolidationDefaults;
  }

  private ruleSimilarity(): AgentContinuityTextSimilarity {
    return new AgentContinuityTextSimilarity(this.factReconciliationPolicy?.().Similarity);
  }

  private invalidateGraphSnapshots(): void {
    this.graphSnapshots.clear();
  }

  listLearningObservations(scopes: readonly AgentContinuityScopeRef[]): AgentContinuityObservation[] {
    return listAgentContinuityLearningObservations(this.db, scopes);
  }

  listTurnValueTrainingExamples(): AgentContinuityTurnValueExample[] {
    return listAgentContinuityTurnValueExamples(this.db);
  }

  recordTurnValueTrainingExample(promptText: string, label: "valuable" | "unproductive", observedAt: string): number {
    return recordAgentContinuityTurnValueExample(this.db, promptText, label, observedAt);
  }

  pruneTurnValueTrainingExamples(maxEntries: number): number {
    return pruneAgentContinuityTurnValueExamples(this.db, maxEntries);
  }

  listFactHeads(scopes: readonly AgentContinuityScopeRef[], now = new Date()): AgentContinuityFactHead[] {
    return listAgentContinuityFactHeads(this.db, scopes, now);
  }

  listFactHistory(scope: AgentContinuityScopeRef, factKey?: string): AgentContinuityFactHistoryEntry[] {
    return listAgentContinuityFactHistory(this.db, scope, factKey);
  }

  listConcepts(scopes: readonly AgentContinuityScopeRef[]): AgentContinuityConceptRecord[] {
    return listAgentContinuityConcepts(this.db, scopes);
  }

  listObservationEmbeddings(observationUris: readonly string[]): Map<string, AgentContinuityObservationEmbedding> {
    return listAgentContinuityObservationEmbeddings(this.db, observationUris);
  }

  upsertObservationEmbeddings(embeddings: readonly AgentContinuityObservationEmbedding[], embeddedAt: string): number {
    return upsertAgentContinuityObservationEmbeddings(this.db, embeddings, embeddedAt);
  }

  /** Removes embeddings whose learning observation or retained physical source no longer exists. */
  pruneObservationEmbeddings(preservedExternalObservationUris: readonly string[] = []): number {
    return pruneAgentContinuityObservationEmbeddings(this.db, preservedExternalObservationUris);
  }

  mergeConcepts(input: AgentContinuityConceptMergeInput): AgentContinuityConceptRecord {
    const concept = mergeAgentContinuityConcepts(this.db, input);
    this.invalidateGraphSnapshots();
    return concept;
  }

  splitConcept(input: AgentContinuityConceptSplitInput): AgentContinuityConceptRecord {
    const concept = splitAgentContinuityConcept(this.db, input);
    this.invalidateGraphSnapshots();
    return concept;
  }

  renameConcept(input: AgentContinuityConceptRenameInput): AgentContinuityConceptRecord {
    const concept = renameAgentContinuityConcept(this.db, input);
    this.invalidateGraphSnapshots();
    return concept;
  }

  correctConcept(input: AgentContinuityConceptCorrectionInput): AgentContinuityConceptRecord {
    const concept = correctAgentContinuityConcept(this.db, input);
    this.invalidateGraphSnapshots();
    return concept;
  }

  recordGraphRelation(input: AgentContinuityGraphRelationDraft): AgentContinuityGraphRelation {
    const relation = recordAgentContinuityGraphRelation(this.db, input, this.consolidation());
    this.invalidateGraphSnapshots();
    return relation;
  }

  recordGraphRelationCandidate(input: AgentContinuityGraphRelationCandidate): AgentContinuityGraphRelation {
    const endpointKinds = resolveAgentContinuityRelationEndpointKinds(input.relationId);
    const entities = this.graphSnapshot([input.scope]).entities;
    const subjectUri = ensureAgentContinuityConcept(this.db, {
      scope: input.scope,
      label: input.subjectLabel,
      aliases: this.entityAliasResolver.resolve({
        label: input.subjectLabel,
        kind: endpointKinds.subjectKind,
        entities,
      }),
      entityKind: endpointKinds.subjectKind,
      observedAt: input.observedAt,
    });
    const objectUri = ensureAgentContinuityConcept(this.db, {
      scope: input.scope,
      label: input.objectLabel,
      aliases: this.entityAliasResolver.resolve({
        label: input.objectLabel,
        kind: endpointKinds.objectKind,
        entities,
      }),
      entityKind: endpointKinds.objectKind,
      observedAt: input.observedAt,
    });
    return this.recordGraphRelation({
      subjectUri,
      relationId: input.relationId,
      objectUri,
      scope: input.scope,
      temporal: input.temporal,
      authority: input.authority,
      confidence: input.confidence,
      sourceRefs: input.sourceRefs,
      observedAt: input.observedAt,
    });
  }

  listGraphRelations(
    scopes: readonly AgentContinuityScopeRef[],
    query?: AgentContinuityGraphRelationQuery,
  ): AgentContinuityGraphRelation[] {
    return listAgentContinuityGraphRelations(this.db, scopes, query);
  }

  listGraphNeighbors(
    scopes: readonly AgentContinuityScopeRef[],
    entityUris: readonly string[],
  ): AgentContinuityGraphRelation[] {
    return listAgentContinuityGraphNeighbors(this.db, scopes, entityUris);
  }

  graphSnapshot(scopes: readonly AgentContinuityScopeRef[]): AgentContinuityGraphSnapshot {
    const key = agentContinuityScopeKey(scopes);
    const revision = continuityGraphCatalogRevision(this.db);
    const cached = this.graphSnapshots.get(key);
    if (cached?.revision === revision) return cached.snapshot;
    const snapshot = snapshotAgentContinuityGraph(this.db, scopes);
    this.graphSnapshots.set(key, { revision, snapshot });
    return snapshot;
  }

  listEventObservations(scopes: readonly AgentContinuityScopeRef[]): AgentContinuityObservation[] {
    return listAgentContinuityEventObservations(this.db, scopes);
  }

  recallCatalogRevision(scopes: readonly AgentContinuityScopeRef[]): string {
    return continuityObservationCatalogRevision(this.db, scopes);
  }

  recordRule(draft: AgentContinuityRuleDraft, now?: string): AgentContinuityRule {
    const rule = recordAgentContinuityRule(this.db, draft, now, this.consolidation(), this.ruleSimilarity());
    this.invalidateGraphSnapshots();
    return rule;
  }

  listLiveRules(scopes: readonly AgentContinuityScopeRef[]): AgentContinuityRule[] {
    return listAgentContinuityLiveRules(this.db, scopes);
  }

  listRules(scopes: readonly AgentContinuityScopeRef[]): AgentContinuityRule[] {
    return listAgentContinuityRules(this.db, scopes);
  }

  updateRuleEvaluation(
    rule: AgentContinuityRule,
    status: AgentContinuityRuleStatus,
    evaluatedAt: string,
  ): AgentContinuityRule {
    return updateAgentContinuityRuleEvaluation(this.db, rule, status, evaluatedAt);
  }

  acknowledgeRuleDeliveries(ruleUris: readonly string[], deliveredAt: string): number {
    return acknowledgeAgentContinuityRuleDeliveries(this.db, ruleUris, deliveredAt);
  }

  upsertSignal(signal: AgentContinuitySignal): void {
    upsertAgentContinuitySignal(this.db, signal);
  }

  listSignals(scopes: readonly AgentContinuityScopeRef[], now = new Date()): AgentContinuitySignal[] {
    return listAgentContinuitySignals(this.db, scopes, now);
  }

  deleteSources(impact: AgentMemoryDeletionImpact): void {
    deleteAgentContinuitySources(this.db, impact, {
      factReconciliation: this.factReconciliation(),
      consolidation: this.consolidation(),
    });
    this.invalidateGraphSnapshots();
  }

  completeFactLearning(
    claim: AgentContinuityLearningClaim,
    input: AgentContinuityFactLearningResult,
    nowMs: number,
  ): AgentContinuityLearningClaimTransition {
    const transition = completeAgentContinuityFactLearning(this.db, claim, input, nowMs, this.learningPersistence());
    if (transition === "committed") this.invalidateGraphSnapshots();
    return transition;
  }

  completeRuleLearning(
    claim: AgentContinuityLearningClaim,
    input: AgentContinuityRuleLearningResult,
    nowMs: number,
  ): AgentContinuityLearningClaimTransition {
    const transition = completeAgentContinuityRuleLearning(this.db, claim, input, nowMs, this.learningPersistence());
    if (transition === "committed") this.invalidateGraphSnapshots();
    return transition;
  }

  enqueueLearning(episodeUri: string, nowMs: number): void {
    enqueueAgentContinuityLearning(this.db, episodeUri, nowMs);
  }

  deferPendingFactJobsForSession(sessionId: string, nowMs: number, deferredUntilMs: number): number {
    return deferAgentContinuityFactJobsForSession(this.db, sessionId, nowMs, deferredUntilMs);
  }

  releasePendingLearningJobs(nowMs: number): number {
    return releaseAgentContinuityPendingLearningJobs(this.db, nowMs);
  }

  recoverInterruptedLearningJobs(nowMs: number): number {
    return recoverAgentContinuityInterruptedLearningJobs(this.db, nowMs);
  }

  listDueLearningJobs(nowMs: number, limit: number): AgentContinuityLearningJob[] {
    return listDueAgentContinuityLearningJobs(this.db, nowMs, limit);
  }

  claimLearningJob(
    episodeUri: string,
    stage: AgentContinuityLearningStage,
    nowMs: number,
  ): AgentContinuityLearningJob | undefined {
    return claimAgentContinuityLearningJob(this.db, episodeUri, stage, nowMs);
  }

  failLearningJob(
    claim: AgentContinuityLearningClaim,
    input: {
      readonly terminal: boolean;
      readonly nextAttemptAtMs: number;
      readonly lastError: string;
      readonly nowMs: number;
    },
  ): AgentContinuityLearningClaimTransition {
    return failAgentContinuityLearningJob(this.db, claim, input);
  }

  nextLearningDueAtMs(): number | undefined {
    return nextAgentContinuityLearningDueAtMs(this.db);
  }

  readLearningInference(inferenceKey: string, usedAtMs: number): AgentContinuityLearningInferenceRecord | undefined {
    return readAgentContinuityLearningInference(this.db, inferenceKey, usedAtMs);
  }

  listLearningInferences(
    stage: AgentContinuityLearningStage,
    contractRevision: string,
    candidateLimit: number,
  ): AgentContinuityLearningInferenceRecord[] {
    return listAgentContinuityLearningInferences(this.db, stage, contractRevision, candidateLimit);
  }

  recordLearningInference(input: AgentContinuityLearningInferenceWrite): AgentContinuityLearningInferenceRecord {
    return recordAgentContinuityLearningInference(this.db, input);
  }

  deleteSession(sessionId: string): void {
    deleteAgentContinuitySession(this.db, sessionId);
    this.invalidateGraphSnapshots();
  }

  close(): void {
    if (this.ownsKernel) this.kernel.close();
  }

  private learningPersistence(): AgentContinuityLearningPersistence {
    return {
      recordObservation: (input) => this.recordObservation(input),
      recordGraphRelationCandidate: (input) => this.recordGraphRelationCandidate(input),
      upsertSignal: (signal) => this.upsertSignal(signal),
      recordRule: (draft, now) => this.recordRule(draft, now),
    };
  }
}
