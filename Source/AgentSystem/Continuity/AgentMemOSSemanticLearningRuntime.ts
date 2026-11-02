import { AgentMemoryDiaryRuntime } from "./AgentMemoryDiaryRuntime.js";
import { AgentMemoryDiaryStore } from "./AgentMemoryDiaryStore.js";
import { agentMemoryEpisodeDisplayValues, readAgentMemoryEpisodeSubject } from "../Memory/AgentMemoryEpisodeRecords.js";
import { agentMemoryDiaryDate, type AgentMemoryDiaryConfig } from "./AgentMemoryDiaryContract.js";
import { projectAgentMemoryDiarySources } from "./AgentMemoryDiarySources.js";
import type { AgentMemoryLearningLedger } from "./AgentMemoryLearningLedger.js";
import { AgentMemOSMemoryAssessment } from "./AgentMemOSMemoryAssessment.js";
import { AgentMemoryUtilityVersion } from "./AgentMemoryUtilityContract.js";
import { AgentMemoryRetrievalTrust } from "./AgentMemoryQuality.js";
import { AgentMemoryRetentionModel } from "./AgentMemoryRetentionModel.js";
import {
  agentMemoryRetention,
  agentMemoryRetentionDeadline,
  AgentMemoryRetentionDecisionSchema,
  type AgentMemoryRetention,
  type AgentMemoryRetentionPolicy,
} from "./AgentMemoryRetention.js";
import type { MemOS, MemoryNode } from "@mem-os/sdk";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { AgentCancellationError } from "../Core/AgentCancellation.js";
import {
  AgentBackgroundLearningExhaustedError,
  type AgentBackgroundLearningRequestLedger,
  type AgentBackgroundLearningRequestFinish,
  type AgentBackgroundLearningRequestStart,
} from "../Memory/AgentBackgroundLearningRequestLedger.js";
import type {
  AgentMemoryEpisodeRecord,
  AgentMemoryRecordedTurn,
  AgentMemorySourceRepository,
} from "../Memory/AgentMemorySourceRepository.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentIdentityDisplayValues } from "../Text/AgentTextParts.js";
import {
  AgentMemOSSemanticModelClient,
  createAgentMemOSExtractionRecordSchema,
} from "./AgentMemOSSemanticModelClient.js";
import type {
  AgentMemOSFragmentHistoryEntry,
  AgentMemOSSemanticCandidate,
  AgentMemOSSemanticDecision,
  AgentMemOSSemanticFragment,
  AgentMemOSSemanticMemoryType,
} from "./AgentMemOSSemanticTypes.js";
import {
  projectAgentMemOSSemanticIdentityDecision,
  projectAgentMemOSSemanticIdentityText,
  projectAgentMemOSSemanticIdentityValue,
} from "./AgentMemOSSemanticIdentity.js";
import {
  AgentMemOSTags,
  AgentMemOSSummarySchema,
  createAgentMemOSFragmentMetadata,
  createAgentMemOSKnowledgeMetadata,
  isAgentMemOSLearningMemoryType,
  mergeAgentMemOSKnowledgeMetadata,
  readAgentMemOSSemanticMetadata,
} from "./AgentMemOSSemanticTypes.js";
import {
  AgentMemOSDeleteRequestSchema,
  AgentMemOSFragmentCommitSchema,
  MaximumTimerDelayMs,
  errorMessage,
  fragmentSourceRevision,
  fragmentTaskKey,
  previewForModel,
  projectMemoryIntents,
  projectStateCard,
  unique,
  validateConfig,
} from "./AgentMemOSSemanticLearningSupport.js";

export interface AgentMemOSSemanticLearningPolicy {
  readonly enabled: boolean;
  readonly maxAttempts: number;
  readonly retryBaseMs: number;
  readonly retryMaxDelayMs: number;
  readonly maxJobsPerDrain: number;
}

export interface AgentMemOSSemanticLearningConfig {
  readonly fragmentHistoryTurns: number;
  readonly knowledgeCandidateLimit: number;
  readonly assistantPreviewTokens: number;
  readonly fragmentSummaryTokenLimit: number;
}

export interface AgentMemOSSemanticLearningFlushOptions {
  /** Background failures remain durable and observable without blocking a foreground lifecycle boundary. */
  readonly surfaceFailures?: boolean;
}

export interface AgentMemOSSemanticLearningRuntimeOptions {
  readonly canonicalSubject?: (subject: string) => string;
  readonly memos: MemOS;
  readonly namespace: string;
  readonly sourceRepository: AgentMemorySourceRepository;
  readonly learningRequests: AgentBackgroundLearningRequestLedger;
  readonly learningLedger?: AgentMemoryLearningLedger;
  readonly modelProvider: () => ResolvedAgentModelProviderConfig;
  readonly policy: () => AgentMemOSSemanticLearningPolicy;
  readonly config: () => AgentMemOSSemanticLearningConfig;
  readonly retentionPolicy: () => AgentMemoryRetentionPolicy;
  readonly retentionInputTokenBudget: () => number;
  readonly cacheScopeKey: string;
  /** Current host profile values are presentation-only, never semantic facts. */
  readonly identityDisplayValues?: (sessionId?: string) => AgentIdentityDisplayValues;
  readonly logger?: AgentLogger;
  readonly diary: {
    readonly store: AgentMemoryDiaryStore;
    readonly config: () => AgentMemoryDiaryConfig;
    readonly now?: () => string;
  };
}

interface AgentMemOSSemanticMatch extends AgentMemOSSemanticCandidate {
  readonly nodeId: string;
}

/**
 * Owns all semantic learning after a turn has been physically committed.
 * MemOS is the only semantic store: the physical source repository is used
 * solely to build bounded context and to recover unfinished work after restart.
 */
export class AgentMemOSSemanticLearningRuntime {
  private readonly assessments: AgentMemOSMemoryAssessment;
  private readonly diaries: AgentMemoryDiaryRuntime;
  private readonly tasks = new Set<Promise<unknown>>();
  private readonly periodTasks = new Map<string, Promise<void>>();
  private readonly dirtyPeriods = new Set<string>();
  private readonly fragmentTasks = new Map<string, Promise<void>>();
  private readonly deletedReferences = new Set<string>();
  private fragmentTail: Promise<void> = Promise.resolve();
  private readonly failures = new Map<string, unknown>();
  private activeLearningSlots = 0;
  private readonly learningSlotWaiters: Array<() => void> = [];
  private started = false;
  private stopped = false;
  private readonly shutdown = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: AgentMemOSSemanticLearningRuntimeOptions) {
    this.assessments = new AgentMemOSMemoryAssessment(options.memos, options.learningLedger);
    validateConfig(options.config());
    this.diaries = new AgentMemoryDiaryRuntime({
      canonicalSubject: options.canonicalSubject,
      store: options.diary.store,
      config: options.diary.config,
      sources: () => this.diarySources(),
      model: options.modelProvider,
      scopeKey: options.cacheScopeKey,
      learningRequests: options.learningRequests,
      withModelSlot: (operation) => this.withLearningSlot(operation),
      policy: options.policy,
      signal: this.shutdown.signal,
      now: options.diary.now,
    });
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    void this.enqueue("recall-settlements", async () => {
      for (const episode of this.options.sourceRepository.listCompletedEpisodes())
        this.options.learningLedger?.completeRecall(episode.sessionId, episode.requestId, episode.completedAt);
      this.scheduleScoreSync();
    });
    void this.enqueue("startup", async () => {
      if (!this.options.policy().enabled) return;
      const deletionRequests = this.options.learningRequests.listAll({
        board: "semantic_memory",
        stage: "semantic_delete",
      });
      const latestDeletes = new Map<string, (typeof deletionRequests)[number]>();
      for (const record of deletionRequests)
        if (!latestDeletes.has(record.operationKey)) latestDeletes.set(record.operationKey, record);
      for (const record of latestDeletes.values()) {
        const references = AgentMemOSDeleteRequestSchema.parse(record.metadata);
        for (const uri of [...references.episodeUris, ...references.sourceUris]) this.deletedReferences.add(uri);
      }
      await this.migrateLegacyDiaries();
      for (const record of latestDeletes.values()) {
        if (!this.options.learningRequests.isRecoverable(record, this.options.policy())) continue;
        const references = AgentMemOSDeleteRequestSchema.parse(record.metadata);
        await this.deleteSources(references.episodeUris, references.sourceUris);
      }
      await this.reconcilePersistedTurns();
      await this.reconcilePeriods();
    });
    if (this.options.policy().enabled) this.scheduleNextBoundary();
  }

  recordCompletedTurn(recordedTurn: AgentMemoryRecordedTurn): void {
    if (this.stopped) return;
    this.options.learningLedger?.completeRecall(
      recordedTurn.episode.sessionId,
      recordedTurn.episode.requestId,
      recordedTurn.episode.completedAt,
    );
    this.deletedReferences.delete(recordedTurn.episode.uri);
    this.start();
    this.scheduleScoreSync();
    if (!this.options.policy().enabled) return;
    void this.enqueue(recordedTurn.episode.uri, async () => {
      try {
        if (recordedTurn.episode.metadata.stateCard !== undefined) await this.scheduleFragment(recordedTurn);
      } finally {
        const timeZone = this.options.diary.config().TimeZone;
        const today = agentMemoryDiaryDate(this.options.diary.now?.() ?? new Date().toISOString(), timeZone);
        if (agentMemoryDiaryDate(recordedTurn.episode.completedAt, timeZone) < today)
          void this.enqueue("diaries", () => this.reconcilePeriods());
      }
    });
  }

  deleteSources(episodeUris: readonly string[], sourceUris: readonly string[]): Promise<void> {
    if (episodeUris.length === 0 && sourceUris.length === 0) return Promise.resolve();
    for (const reference of [...episodeUris, ...sourceUris]) this.deletedReferences.add(reference);
    const operationKey = `delete:${sha256HexOfCanonicalJson([...episodeUris, ...sourceUris])}`;
    const precedingFragments = this.fragmentTail;
    const task = this.enqueue(operationKey, () =>
      this.runWithRetry(
        {
          operationKey,
          board: "semantic_memory",
          stage: "semantic_delete",
          metadata: { episodeUris: [...episodeUris], sourceUris: [...sourceUris] },
        },
        async () => {
          // The request is durable before waiting for extraction or changing derived files.
          this.diaries.invalidateSources(episodeUris, sourceUris);
          await precedingFragments;
          const deleted = new Set([...episodeUris, ...sourceUris]);
          const fragments = (await this.listSemanticNodes([AgentMemOSTags.semantic, AgentMemOSTags.fragment])).filter(
            (node) => this.isDeletedFragment(node, deleted),
          );
          const fragmentsById = new Set(fragments.map((fragment) => fragment.id));
          const impactedKnowledgeIds = new Set<string>();
          for (const fragment of fragments) {
            for (const edge of await this.options.memos.getEdges(fragment.id)) {
              if (edge.relation === "derived_from" && edge.targetId === fragment.id)
                impactedKnowledgeIds.add(edge.sourceId);
            }
          }
          await Promise.all(fragments.map((fragment) => this.options.memos.forget(fragment.id)));
          await Promise.all(
            [...impactedKnowledgeIds].map((knowledgeId) =>
              this.removeDeletedKnowledgeContribution(knowledgeId, fragmentsById),
            ),
          );
          this.scheduleScoreSync();
        },
      ),
    );
    this.fragmentTail = task.catch(() => {});
    void task.then(
      () => {
        void this.enqueue("diaries", () => this.reconcilePeriods());
      },
      () => {},
    );
    return task;
  }

  async flush(options: AgentMemOSSemanticLearningFlushOptions = {}): Promise<void> {
    while (this.tasks.size > 0) await Promise.allSettled([...this.tasks]);
    try {
      await this.synchronizeScores();
      this.failures.delete("knowledge-scores");
    } catch (error) {
      this.failures.set("knowledge-scores", error);
      this.options.logger?.warn("memory.memos.score_sync_failed", { message: errorMessage(error) });
    }
    if (options.surfaceFailures !== false && this.failures.size > 0)
      throw new AggregateError([...this.failures.values()], "MemOS background learning failed.");
  }

  async stop(options: AgentMemOSSemanticLearningFlushOptions = {}): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.shutdown.abort(new AgentCancellationError("Memory learning runtime stopped."));
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.flush(options);
  }

  private async learnFragment(recordedTurn: AgentMemoryRecordedTurn, force = false): Promise<void> {
    if (this.deletedReferences.has(recordedTurn.episode.uri)) return;
    const operationKey = `memos:fragment:${recordedTurn.episode.uri}:${recordedTurn.episode.updatedAt}`;
    const sourceRevision = fragmentSourceRevision(recordedTurn.episode);
    let previousCommit: ReturnType<typeof AgentMemOSFragmentCommitSchema.parse> | undefined;
    if (!force) {
      const completed = this.options.learningRequests.list({
        board: "semantic_memory",
        stage: "semantic_fragment",
        entityUri: recordedTurn.episode.uri,
        sourceRevision,
        status: "completed",
        limit: 1,
      })[0];
      if (completed) {
        const commit = AgentMemOSFragmentCommitSchema.parse(completed.metadata);
        const assessmentCurrent =
          commit.assessmentVersion === AgentMemoryUtilityVersion ||
          !this.options.learningLedger?.delivered(recordedTurn.episode.sessionId, recordedTurn.episode.requestId)
            .length;
        if (commit.nodeIds.length === 0 && assessmentCurrent) return;
        const nodes = await Promise.all(commit.nodeIds.map((id) => this.options.memos.retrieve(id)));
        if (nodes.every(Boolean)) {
          if (assessmentCurrent) return;
          previousCommit = commit;
        } else force = true;
      }
    }
    const stateCard = projectStateCard(recordedTurn.episode.metadata.stateCard);
    if (!stateCard) return;
    const identity = agentMemoryEpisodeDisplayValues(
      recordedTurn.episode,
      this.options.identityDisplayValues?.(recordedTurn.episode.sessionId),
    );
    const model = this.options.modelProvider();
    const config = this.options.config();
    const ledger = this.options.learningLedger;
    const task = ledger?.binding(recordedTurn.episode.sessionId, recordedTurn.episode.requestId);
    const deliveries = ledger?.delivered(recordedTurn.episode.sessionId, recordedTurn.episode.requestId) ?? [];
    const deliveryRevision = sha256HexOfCanonicalJson(deliveries);
    const learningOperationKey = `${operationKey}:utility:${AgentMemoryUtilityVersion}:delivery:${deliveryRevision}`;
    const sources = this.assessments.sources(recordedTurn);
    const isCurrent = () =>
      !this.deletedReferences.has(recordedTurn.episode.uri) &&
      this.isCurrentEpisode(recordedTurn.episode, sourceRevision);
    const extractionRecordSchema = createAgentMemOSExtractionRecordSchema(config.fragmentSummaryTokenLimit);
    await this.withLearningSlot(async () => {
      await this.runWithRetry(
        {
          operationKey: learningOperationKey,
          board: "semantic_memory",
          stage: "semantic_fragment",
          entityUri: recordedTurn.episode.uri,
          sessionId: recordedTurn.episode.sessionId,
          sourceRevision,
          providerId: model.Id,
          model: model.Model,
        },
        async (attempt) => {
          const cached = !force
            ? this.options.learningRequests.list({
                board: "semantic_memory",
                stage: "semantic_extract",
                entityUri: recordedTurn.episode.uri,
                sourceRevision,
                status: "completed",
                limit: 1,
              })[0]
            : undefined;
          const cachedExtraction =
            cached?.metadata.assessmentVersion === AgentMemoryUtilityVersion &&
            cached.metadata.deliveryRevision === deliveryRevision
              ? extractionRecordSchema.parse(cached.metadata)
              : undefined;
          const committedFragment = await this.findByMetadata([AgentMemOSTags.semantic, AgentMemOSTags.fragment], {
            senera_operation_key: operationKey,
          });
          const contribution = committedFragment
            ? (await this.options.memos.getEdges(committedFragment.id)).find(
                (edge) => edge.targetId === committedFragment.id && edge.relation === "derived_from",
              )
            : undefined;
          const candidates = cachedExtraction
            ? []
            : await this.findKnowledgeCandidates(
                recordedTurn.episode.standaloneRequest,
                config.knowledgeCandidateLimit,
                task,
              );
          if (!cachedExtraction && ledger) {
            for (const delivery of deliveries) {
              const match = candidates.find((candidate) => candidate.nodeId === delivery.id);
              if (match) {
                candidates[candidates.indexOf(match)] = {
                  ...match,
                  delivered: true,
                  deliveredVersions: [
                    ...(match.deliveredVersions ?? []),
                    { revision: delivery.revision, summary: delivery.summary },
                  ],
                };
                continue;
              }
              const node = await this.options.memos.retrieve(delivery.id);
              if (node && isAgentMemOSLearningMemoryType(node.type)) {
                const metadata = readAgentMemOSSemanticMetadata(node);
                candidates.push({
                  ref: candidates.length,
                  nodeId: node.id,
                  summary: AgentMemOSSummarySchema.parse(node.summary),
                  type: node.type,
                  delivered: true,
                  assessmentOnly:
                    task !== undefined &&
                    (!this.sameSubject(metadata?.senera_subject_id, task.subjectId) ||
                      (node.type === "context" && metadata?.senera_task_id !== task.taskId)),
                  deliveredVersions: [{ revision: delivery.revision, summary: delivery.summary }],
                });
              }
            }
          }
          const client = new AgentMemOSSemanticModelClient(
            model,
            this.options.cacheScopeKey,
            config.fragmentSummaryTokenLimit,
          );
          const result: AgentMemOSSemanticDecision = cachedExtraction
            ? cachedExtraction.fragment.action === "skip"
              ? cachedExtraction.fragment
              : client.normalizeFragment(cachedExtraction.fragment)
            : await this.options.learningRequests.run(
                {
                  operationKey: learningOperationKey,
                  board: "semantic_memory",
                  stage: "semantic_extract",
                  entityUri: recordedTurn.episode.uri,
                  sessionId: recordedTurn.episode.sessionId,
                  sourceRevision,
                  providerId: model.Id,
                  model: model.Model,
                  attempt,
                },
                () =>
                  client
                    .extractFragment(
                      {
                        subject: readAgentMemoryEpisodeSubject(recordedTurn.episode),
                        user: projectAgentMemOSSemanticIdentityText(recordedTurn.episode.rawUserText, identity),
                        assistant: projectAgentMemOSSemanticIdentityText(
                          previewForModel(
                            recordedTurn.episode.assistantText,
                            model.Model,
                            config.assistantPreviewTokens,
                          ),
                          identity,
                        ),
                        stateCard: projectAgentMemOSSemanticIdentityValue(stateCard, identity),
                        memoryIntents: projectAgentMemOSSemanticIdentityValue(
                          projectMemoryIntents(recordedTurn),
                          identity,
                        ),
                        history: this.projectHistory(recordedTurn.episode, model.Model, identity),
                        candidates: candidates.map(
                          ({ ref, summary, type, delivered, deliveredVersions, assessmentOnly }) => ({
                            ref,
                            summary: projectAgentMemOSSemanticIdentityText(summary, identity),
                            type,
                            ...(delivered ? { delivered } : {}),
                            ...(assessmentOnly ? { assessmentOnly } : {}),
                            ...(deliveredVersions
                              ? {
                                  deliveredVersions: deliveredVersions.map((version) => ({
                                    revision: version.revision,
                                    summary: projectAgentMemOSSemanticIdentityText(version.summary, identity),
                                  })),
                                }
                              : {}),
                          }),
                        ),
                        ...(ledger || sources.length
                          ? {
                              sources: sources.map((source, ref) => ({
                                ref,
                                kind: source.sourceKind,
                                text: source.textContent ?? source.summary ?? "",
                              })),
                            }
                          : {}),
                      },
                      learningOperationKey,
                      this.shutdown.signal,
                    )
                    .then((decision) => projectAgentMemOSSemanticIdentityDecision(decision, identity)),
                (fragment) => ({
                  metadata: extractionRecordSchema.parse({
                    fragment,
                    assessmentVersion: AgentMemoryUtilityVersion,
                    deliveryRevision,
                    assessmentTargets: candidates.map((candidate) => candidate.nodeId),
                    ...(fragment.action === "skip" || fragment.candidate === undefined
                      ? {}
                      : { candidateId: candidates[fragment.candidate]?.nodeId }),
                  }),
                }),
              );
          let resolvedResult = projectAgentMemOSSemanticIdentityDecision(result, identity);
          const assessmentTargets = cachedExtraction
            ? cachedExtraction.assessmentTargets
            : candidates.map((candidate) => candidate.nodeId);
          if (!isCurrent()) return [];
          // Re-evaluate old task utility independently of its already committed
          // knowledge. An assessment upgrade must never learn the same turn twice.
          const retainedNodes =
            previousCommit?.nodeIds ??
            (committedFragment && contribution
              ? unique([
                  committedFragment.id,
                  contribution.sourceId,
                  ...(cachedExtraction?.candidateId ? [cachedExtraction.candidateId] : []),
                ])
              : undefined);
          if (
            !retainedNodes &&
            cachedExtraction &&
            resolvedResult.action !== "skip" &&
            resolvedResult.candidate !== undefined
          ) {
            if (!cachedExtraction.candidateId) throw new Error("Persisted MemOS reconciliation is missing its target.");
            const target = await this.options.memos.retrieve(cachedExtraction.candidateId);
            if (!target) {
              throw new Error("The persisted MemOS reconciliation target is no longer available.");
            }
            if (!isAgentMemOSLearningMemoryType(target.type)) {
              throw new Error("The persisted MemOS reconciliation target has an unsupported semantic type.");
            }
            candidates.push({
              ref: 0,
              nodeId: target.id,
              summary: AgentMemOSSummarySchema.parse(target.summary),
              type: target.type,
            });
            resolvedResult = { ...resolvedResult, candidate: 0 };
          }
          if (this.deletedReferences.has(recordedTurn.episode.uri)) return [];
          if (!this.isCurrentEpisode(recordedTurn.episode, sourceRevision)) return [];
          const nodeIds =
            retainedNodes ??
            (resolvedResult.action === "skip"
              ? []
              : await this.reconcileFragment(
                  recordedTurn,
                  resolvedResult,
                  candidates,
                  operationKey,
                  await this.resolveRetention(recordedTurn, resolvedResult, candidates, model, attempt),
                ));
          await this.assessments.settle(recordedTurn, resolvedResult, assessmentTargets, nodeIds[1], isCurrent);
          return nodeIds;
        },
        (nodeIds) => ({
          metadata: AgentMemOSFragmentCommitSchema.parse({ nodeIds, assessmentVersion: AgentMemoryUtilityVersion }),
        }),
      );
    });
  }

  private projectHistory(
    current: AgentMemoryEpisodeRecord,
    model: string,
    identity: AgentIdentityDisplayValues | undefined,
  ): AgentMemOSFragmentHistoryEntry[] {
    const history = this.options.sourceRepository
      .listEpisodes(current.sessionId)
      .filter(
        (episode) =>
          !this.options.canonicalSubject ||
          this.sameSubject(readAgentMemoryEpisodeSubject(current)?.id, readAgentMemoryEpisodeSubject(episode)?.id),
      )
      .filter((episode) => episode.uri !== current.uri && episode.completedAtMs <= current.startedAtMs)
      .slice()
      .sort((left, right) => right.completedAtMs - left.completedAtMs || right.id.localeCompare(left.id))
      .slice(0, this.options.config().fragmentHistoryTurns)
      .reverse();
    return history.flatMap((episode) => {
      const episodeIdentity = agentMemoryEpisodeDisplayValues(episode, identity);
      const stateCard = projectStateCard(episode.metadata.stateCard);
      if (!stateCard) return [];
      return {
        user: projectAgentMemOSSemanticIdentityText(episode.rawUserText, episodeIdentity),
        assistant: projectAgentMemOSSemanticIdentityText(
          previewForModel(episode.assistantText, model, this.options.config().assistantPreviewTokens),
          episodeIdentity,
        ),
        stateCard: projectAgentMemOSSemanticIdentityValue(stateCard, episodeIdentity),
      };
    });
  }

  private async reconcilePersistedTurns(): Promise<void> {
    const persisted = this.options.sourceRepository.listCompletedEpisodes();
    const candidates = persisted
      .filter((episode) => projectStateCard(episode.metadata.stateCard))
      .sort((left, right) => left.completedAtMs - right.completedAtMs || left.id.localeCompare(right.id));
    const limit = this.options.policy().maxJobsPerDrain;
    for (let offset = 0; offset < candidates.length; offset += limit) {
      if (this.stopped) return;
      const batch = candidates.slice(offset, offset + limit);
      await Promise.allSettled(
        batch.map((episode) =>
          this.enqueue(episode.uri, () =>
            this.scheduleFragment({
              episode,
              sources: this.options.sourceRepository.listSources(episode.uri),
            }),
          ),
        ),
      );
    }
  }

  private async resolveRetention(
    turn: AgentMemoryRecordedTurn,
    fragment: AgentMemOSSemanticFragment,
    candidates: readonly AgentMemOSSemanticMatch[],
    model: ResolvedAgentModelProviderConfig,
    attempt: number,
  ): Promise<AgentMemoryRetention> {
    const policy = this.options.retentionPolicy();
    const confirmedAt = turn.episode.completedAt;
    if (fragment.type !== "fact") return { days: fragment.type === "context" ? policy.ContextDays : 0, confirmedAt };
    const targetId = fragment.candidate === undefined ? undefined : candidates[fragment.candidate]?.nodeId;
    const target = targetId ? await this.options.memos.retrieve(targetId) : undefined;
    const previous = target ? agentMemoryRetention(target, policy) : undefined;
    const sourceRevision = sha256HexOfCanonicalJson({
      episode: fragmentSourceRevision(turn.episode),
      fact: { topic: fragment.topic, summary: fragment.summary },
      previous,
      defaultDays: policy.FactDays,
    });
    const cached = this.options.learningRequests.list({
      board: "semantic_memory",
      stage: "semantic_retention",
      entityUri: turn.episode.uri,
      sourceRevision,
      status: "completed",
      limit: 1,
    })[0];
    const decision = cached
      ? AgentMemoryRetentionDecisionSchema.parse(cached.metadata.retention)
      : await this.options.learningRequests.run(
          {
            operationKey: `memory-retention:${sourceRevision}`,
            board: "semantic_memory",
            stage: "semantic_retention",
            entityUri: turn.episode.uri,
            sessionId: turn.episode.sessionId,
            sourceRevision,
            providerId: model.Id,
            model: model.Model,
            attempt,
          },
          () =>
            new AgentMemoryRetentionModel(model, this.options.cacheScopeKey).assess(
              {
                fact: { topic: fragment.topic, summary: fragment.summary },
                user: turn.episode.rawUserText,
                memoryIntents: projectMemoryIntents(turn),
                history: this.projectHistory(
                  turn.episode,
                  model.Model,
                  this.options.identityDisplayValues?.(turn.episode.sessionId),
                ).map(({ user, assistant }) => ({ request: user, assistant })),
                sources: this.assessments
                  .sources(turn)
                  .map((source) => ({ kind: source.sourceKind, text: source.textContent ?? source.summary ?? "" })),
                previous,
                confirmedAt,
                defaultDays: policy.FactDays,
                inputTokenBudget: this.options.retentionInputTokenBudget(),
              },
              `memory-retention:${sourceRevision}`,
              this.shutdown.signal,
            ),
          (retention) => ({ metadata: { retention } }),
        );
    const retention = { ...decision, confirmedAt };
    agentMemoryRetentionDeadline(retention);
    return retention;
  }

  private async reconcileFragment(
    recordedTurn: AgentMemoryRecordedTurn,
    fragment: AgentMemOSSemanticFragment,
    candidates: readonly AgentMemOSSemanticMatch[],
    operationKey: string,
    retention: AgentMemoryRetention,
  ): Promise<readonly string[]> {
    const { episode, sources } = recordedTurn;
    const task = this.options.learningLedger?.binding(episode.sessionId, episode.requestId);
    if (this.deletedReferences.has(episode.uri) || !this.isCurrentEpisode(episode, fragmentSourceRevision(episode)))
      return [];
    const existingKnowledge = await this.findByMetadata([AgentMemOSTags.semantic, AgentMemOSTags.knowledge], {
      senera_operation_key: operationKey,
    });
    const candidate = fragment.candidate === undefined ? undefined : candidates[fragment.candidate];
    if (!existingKnowledge && (fragment.action === "update" || fragment.action === "supersede") && !candidate) {
      throw new Error(`MemOS semantic action ${fragment.action} references an unavailable candidate.`);
    }
    const content = `${fragment.topic}\n${fragment.summary}`;
    let fragmentNode = await this.findByMetadata([AgentMemOSTags.semantic, AgentMemOSTags.fragment], {
      senera_operation_key: operationKey,
    });
    if (!fragmentNode)
      fragmentNode = (
        await this.options.memos.store(content, {
          type: fragment.type,
          summary: fragment.summary,
          source: "agent_inferred",
          namespace: this.options.namespace,
          validFrom: episode.completedAtMs,
          tags: [AgentMemOSTags.semantic, AgentMemOSTags.fragment],
          metadata: {
            ...createAgentMemOSFragmentMetadata({ episode, sources, operationKey }),
            senera_retention: retention,
          },
        })
      ).node;
    let knowledgeId = existingKnowledge?.id;
    if (!knowledgeId && fragment.action === "update" && candidate) {
      const current = await this.options.memos.retrieve(candidate.nodeId);
      if (!current) throw new Error(`MemOS candidate ${candidate.nodeId} disappeared before update.`);
      const updated = await this.options.memos.update(candidate.nodeId, {
        content,
        summary: fragment.summary,
        type: fragment.type,
        metadata: {
          ...mergeAgentMemOSKnowledgeMetadata(current, { episode, sources, operationKey, type: fragment.type }),
          senera_retention: retention,
          ...(task ? { senera_task_id: task.taskId, senera_subject_id: task.subjectId } : {}),
        },
      });
      if (!updated) throw new Error(`MemOS candidate ${candidate.nodeId} disappeared before update.`);
      knowledgeId = candidate.nodeId;
    }
    if (!knowledgeId) knowledgeId = (await this.storeKnowledgeNode(recordedTurn, fragment, operationKey, retention)).id;
    if (fragment.action === "supersede" && candidate) {
      const superseded = await this.options.memos.supersede(candidate.nodeId, knowledgeId);
      if (!superseded) throw new Error(`MemOS candidate ${candidate.nodeId} disappeared before supersede.`);
      await this.options.memos.setValidity(candidate.nodeId, superseded.validFrom, episode.completedAtMs);
    }
    const edges = await this.options.memos.getEdges(knowledgeId);
    if (!edges.some((edge) => edge.targetId === fragmentNode.id && edge.relation === "derived_from"))
      await this.options.memos.link(knowledgeId, fragmentNode.id, "derived_from");
    return unique([fragmentNode.id, knowledgeId, ...(candidate ? [candidate.nodeId] : [])]);
  }

  private async storeKnowledgeNode(
    recordedTurn: AgentMemoryRecordedTurn,
    fragment: AgentMemOSSemanticFragment,
    operationKey: string,
    retention: AgentMemoryRetention,
  ): Promise<MemoryNode> {
    const { episode, sources } = recordedTurn;
    const task = this.options.learningLedger?.binding(episode.sessionId, episode.requestId);
    const stored = await this.options.memos.store(`${fragment.topic}\n${fragment.summary}`, {
      type: fragment.type,
      summary: fragment.summary,
      source: "agent_inferred",
      trustScore: AgentMemoryRetrievalTrust,
      namespace: this.options.namespace,
      validFrom: episode.completedAtMs,
      tags: [AgentMemOSTags.semantic, AgentMemOSTags.knowledge],
      metadata: {
        ...createAgentMemOSKnowledgeMetadata({ episode, sources, operationKey, type: fragment.type }),
        senera_retention: retention,
        ...(task ? { senera_task_id: task.taskId, senera_subject_id: task.subjectId } : {}),
      },
    });
    return stored.node;
  }

  private sameSubject(left: string | undefined, right: string | undefined): boolean {
    if (!left || !right) return false;
    const canonical = this.options.canonicalSubject;
    return canonical ? canonical(left) === canonical(right) : left === right;
  }

  private async findKnowledgeCandidates(
    query: string,
    limit: number,
    task?: { readonly subjectId: string; readonly taskId: string },
  ): Promise<AgentMemOSSemanticMatch[]> {
    await this.options.memos.flushEmbeddings();
    const results = await this.options.memos.search({
      query: query.trim(),
      namespace: this.options.namespace,
      tags: [AgentMemOSTags.semantic, AgentMemOSTags.knowledge],
      limit: this.semanticNodeScanLimit(),
      sortBy: "relevance",
      sortOrder: "desc",
    });
    const matches = results
      .filter(
        (
          result,
        ): result is (typeof results)[number] & {
          readonly node: MemoryNode & { readonly type: AgentMemOSSemanticMemoryType };
        } =>
          isAgentMemOSLearningMemoryType(result.node.type) &&
          readAgentMemOSSemanticMetadata(result.node)?.senera_scope !== "period" &&
          (!task ||
            (this.sameSubject(readAgentMemOSSemanticMetadata(result.node)?.senera_subject_id, task.subjectId) &&
              (result.node.type !== "context" ||
                readAgentMemOSSemanticMetadata(result.node)?.senera_task_id === task.taskId))),
      )
      .slice(0, limit)
      .map(({ node }) => ({
        nodeId: node.id,
        summary: AgentMemOSSummarySchema.parse(node.summary),
        type: node.type,
      }));
    return matches.map((match, ref) => ({ ...match, ref }));
  }

  private async reconcilePeriods(): Promise<void> {
    if (this.stopped || !this.options.policy().enabled) return;
    await this.schedulePeriod("diaries", () => this.diaries.reconcile());
  }

  private async diarySources() {
    return projectAgentMemoryDiarySources({
      fragments: await this.listSemanticNodes([AgentMemOSTags.semantic, AgentMemOSTags.fragment]),
      requests: this.options.learningRequests.listAll({ board: "semantic_memory", stage: "semantic_fragment" }),
      sourceRepository: this.options.sourceRepository,
      learningLedger: this.options.learningLedger,
      deletedReferences: this.deletedReferences,
      identityDisplayValues: this.options.identityDisplayValues,
    });
  }

  /** Export before retiring the old authority. The archive is migration data, never a retrieval fallback. */
  private async migrateLegacyDiaries(): Promise<void> {
    const today = agentMemoryDiaryDate(
      this.options.diary.now?.() ?? new Date().toISOString(),
      this.options.diary.config().TimeZone,
    );
    for (const tag of [AgentMemOSTags.dailyDigest, AgentMemOSTags.monthlyDigest]) {
      const nodes = await this.listSemanticNodes([AgentMemOSTags.semantic, tag]);
      for (const node of nodes) {
        const metadata = readAgentMemOSSemanticMetadata(node);
        if (metadata?.senera_scope !== "period") throw new Error(`Legacy period has no validated metadata: ${node.id}`);
        const provenance = metadata.senera_source_uris ?? [];
        if (
          provenance.some((uri) => this.deletedReferences.has(uri)) ||
          (!provenance.length && this.deletedReferences.size > 0)
        ) {
          await this.options.memos.forget(node.id);
          continue;
        }
        const key = metadata.senera_period_key!;
        this.options.diary.store.archiveLegacy(key, node.id, node.content);
        const closed = metadata.senera_period_granularity === "day" ? key < today : key < today.slice(0, 7);
        if (closed && !this.options.diary.store.read(key))
          this.options.diary.store.write(
            key,
            { title: key, body: node.content },
            {
              revision: `legacy:${node.id}`,
              episodeUris: [],
              sourceUris: metadata.senera_source_uris ?? [],
              importedFrom: node.id,
            },
          );
        await this.options.memos.forget(node.id);
      }
    }
  }

  private async listSemanticNodes(tags: readonly string[]): Promise<MemoryNode[]> {
    const results = await this.options.memos.search({
      namespace: this.options.namespace,
      tags: [...tags],
      limit: this.semanticNodeScanLimit(),
      sortBy: "updatedAt",
      sortOrder: "asc",
    });
    return results.map((result) => result.node);
  }

  private async findByMetadata(
    tags: readonly string[],
    metadata: Readonly<Record<string, unknown>>,
  ): Promise<MemoryNode | undefined> {
    const results = await this.options.memos.search({
      namespace: this.options.namespace,
      tags: [...tags],
      metadata: { ...metadata },
      limit: 1,
      sortBy: "updatedAt",
      sortOrder: "desc",
    });
    return results[0]?.node;
  }

  private isDeletedFragment(node: MemoryNode, deletedReferences: ReadonlySet<string>): boolean {
    const metadata = readAgentMemOSSemanticMetadata(node);
    return (
      metadata !== undefined &&
      (deletedReferences.has(metadata.senera_episode_uri ?? "") ||
        (metadata.senera_source_uris ?? []).some((sourceUri) => deletedReferences.has(sourceUri)))
    );
  }

  private async removeDeletedKnowledgeContribution(
    knowledgeId: string,
    deletedFragmentIds: ReadonlySet<string>,
  ): Promise<void> {
    const knowledge = await this.options.memos.retrieve(knowledgeId);
    if (!knowledge) return;
    const remainingFragmentIds = (await this.options.memos.getEdges(knowledgeId))
      .filter((edge) => edge.sourceId === knowledgeId && edge.relation === "derived_from")
      .map((edge) => edge.targetId)
      .filter((fragmentId) => !deletedFragmentIds.has(fragmentId));
    const fragments = (
      await Promise.all(remainingFragmentIds.map((fragmentId) => this.options.memos.retrieve(fragmentId)))
    ).filter((fragment): fragment is MemoryNode => fragment !== undefined);
    if (fragments.length === 0) {
      await this.options.memos.forget(knowledgeId);
      this.options.learningLedger?.forget(knowledgeId);
      return;
    }
    const provenance = fragments
      .map(readAgentMemOSSemanticMetadata)
      .filter((value): value is NonNullable<typeof value> => value !== undefined);
    if (provenance.length === 0) {
      await this.options.memos.forget(knowledgeId);
      this.options.learningLedger?.forget(knowledgeId);
      return;
    }
    const latestFragment = [...fragments].sort(
      (left, right) =>
        (right.validFrom ?? right.createdAt) - (left.validFrom ?? left.createdAt) || right.id.localeCompare(left.id),
    )[0]!;
    if (!isAgentMemOSLearningMemoryType(latestFragment.type)) {
      throw new Error(`MemOS fragment ${latestFragment.id} has an unsupported semantic type.`);
    }
    const representative = provenance[0]!;
    const metadata = {
      ...knowledge.metadata,
      senera_schema: representative.senera_schema,
      senera_domain: representative.senera_domain,
      senera_scope: knowledge.type === "context" ? "session" : "workspace",
      senera_operation_key: representative.senera_operation_key,
      senera_episode_uri: representative.senera_episode_uri,
      senera_source_uris: unique(provenance.flatMap((value) => value.senera_source_uris ?? [])),
      senera_source_session_ids: unique(provenance.flatMap((value) => value.senera_source_session_ids ?? [])),
      senera_source_request_ids: unique(provenance.flatMap((value) => value.senera_source_request_ids ?? [])),
      senera_retention: agentMemoryRetention(latestFragment, this.options.retentionPolicy()),
    };
    const updated = await this.options.memos.update(knowledgeId, {
      content: latestFragment.content,
      summary: AgentMemOSSummarySchema.parse(latestFragment.summary),
      type: latestFragment.type,
      validFrom: latestFragment.validFrom,
      metadata,
    });
    if (!updated) throw new Error(`MemOS knowledge node ${knowledgeId} disappeared during provenance reconciliation.`);
  }

  private semanticNodeScanLimit(): number {
    return Math.max(this.options.memos.count, 1);
  }

  private schedulePeriod(key: string, operation: () => Promise<void>): Promise<void> {
    const existing = this.periodTasks.get(key);
    if (existing) {
      this.dirtyPeriods.add(key);
      return existing;
    }
    const task = this.track(
      (async () => {
        do {
          this.dirtyPeriods.delete(key);
          await operation();
        } while (this.dirtyPeriods.has(key));
      })(),
    );
    this.periodTasks.set(key, task);
    void task.then(
      () => {
        this.periodTasks.delete(key);
        this.dirtyPeriods.delete(key);
      },
      () => {
        this.periodTasks.delete(key);
        this.dirtyPeriods.delete(key);
      },
    );
    return task;
  }

  private scheduleScoreSync(): void {
    void this.enqueue("knowledge-scores", () => this.synchronizeScores());
  }

  private synchronizeScores(): Promise<void> {
    return this.schedulePeriod("knowledge-scores", async () => {
      const ledger = this.options.learningLedger;
      if (!ledger) return;
      const failures: unknown[] = [];
      for (const update of ledger.pendingScoreUpdates()) {
        try {
          const node = await this.options.memos.retrieve(update.nodeId);
          // Missing nodes are not recreated; source erasure owns their lifecycle.
          if (node && node.trustScore !== AgentMemoryRetrievalTrust)
            await this.options.memos.setTrust(update.nodeId, AgentMemoryRetrievalTrust);
          ledger.acknowledgeScoreUpdate(update.nodeId, update.revision);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length) throw new AggregateError(failures, "Memory score synchronization failed.");
    });
  }

  private isCurrentEpisode(episode: AgentMemoryEpisodeRecord, sourceRevision: string): boolean {
    const current = this.options.sourceRepository.findEpisodesByUris([episode.uri])[0];
    return current !== undefined && fragmentSourceRevision(current) === sourceRevision;
  }

  private enqueue(key: string, operation: () => Promise<void>): Promise<void> {
    const tracked = this.track(operation());
    void tracked.then(
      () => this.failures.delete(key),
      (error) => {
        if (error instanceof AgentBackgroundLearningExhaustedError) {
          this.failures.delete(key);
          return;
        }
        if (this.stopped && error === this.shutdown.signal.reason) return;
        this.failures.set(key, error);
        this.options.logger?.warn("memory.memos.semantic_learning.failed", {
          operationKey: key,
          message: errorMessage(error),
        });
      },
    );
    return tracked;
  }

  private scheduleFragment(recordedTurn: AgentMemoryRecordedTurn, force = false): Promise<void> {
    const key = fragmentTaskKey(recordedTurn.episode);
    const existing = this.fragmentTasks.get(key);
    if (existing) return existing;
    const task = this.track(
      this.fragmentTail.then(async () => {
        try {
          await this.learnFragment(recordedTurn, force);
        } finally {
          this.scheduleScoreSync();
        }
      }),
    );
    this.fragmentTail = task.catch(() => {});
    this.fragmentTasks.set(key, task);
    void task.then(
      () => this.fragmentTasks.delete(key),
      () => this.fragmentTasks.delete(key),
    );
    return task;
  }

  private async withLearningSlot<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.acquireLearningSlot();
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async acquireLearningSlot(): Promise<() => void> {
    const limit = this.options.policy().maxJobsPerDrain;
    if (this.activeLearningSlots >= limit) {
      await new Promise<void>((resolve) => this.learningSlotWaiters.push(resolve));
    } else {
      this.activeLearningSlots += 1;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.learningSlotWaiters.shift();
      if (next) next();
      else this.activeLearningSlots -= 1;
    };
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.tasks.add(promise);
    void promise.then(
      () => this.tasks.delete(promise),
      () => this.tasks.delete(promise),
    );
    return promise;
  }

  private async runWithRetry<T>(
    input: Omit<AgentBackgroundLearningRequestStart, "attempt" | "startedAtMs">,
    operation: (attempt: number) => Promise<T>,
    finish?: (result: T) => AgentBackgroundLearningRequestFinish,
  ): Promise<T> {
    return this.options.learningRequests.runRetried(
      input,
      this.options.policy(),
      operation,
      finish,
      this.shutdown.signal,
    );
  }

  private scheduleNextBoundary(): void {
    if (this.stopped) return;
    const delay = Math.min(Math.max(0, this.diaries.nextBoundaryDelay()), MaximumTimerDelayMs);
    this.timer = setTimeout(() => {
      void this.enqueue("period-boundary", async () => {
        try {
          await this.reconcilePeriods();
        } finally {
          this.scheduleNextBoundary();
        }
      });
      this.timer = undefined;
    }, delay);
    this.timer.unref?.();
  }
}
