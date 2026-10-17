import { Temporal } from "@js-temporal/polyfill";
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
import { DefaultAgentTimeZone, projectAgentTime } from "../Time/AgentTime.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import {
  AgentMemOSSemanticModelClient,
  createAgentMemOSExtractionRecordSchema,
} from "./AgentMemOSSemanticModelClient.js";
import type {
  AgentMemOSDigestEntry,
  AgentMemOSFragmentHistoryEntry,
  AgentMemOSSemanticCandidate,
  AgentMemOSSemanticFragment,
} from "./AgentMemOSSemanticTypes.js";
import {
  AgentMemOSTags,
  agentMemOSDayTag,
  agentMemOSMonthTag,
  agentMemOSWriteTag,
  agentMemOSLocalMonth,
  readAgentMemOSDay,
  readAgentMemOSMonth,
  replaceAgentMemOSWriteTag,
  AgentMemOSSummarySchema,
} from "./AgentMemOSSemanticTypes.js";
import {
  AgentMemOSDeleteRequestSchema,
  AgentMemOSFragmentCommitSchema,
  MaximumTimerDelayMs,
  completedDate,
  digestSourceRevision,
  errorMessage,
  firstEntry,
  fragmentSourceRevision,
  fragmentTaskKey,
  previewForModel,
  projectDigestEntry,
  projectMemoryIntents,
  projectStateCard,
  readNodeIds,
  splitByTokenBudget,
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
  readonly digestInputTokenBudget: number;
  readonly digestSummaryTokenLimit: number;
}

export interface AgentMemOSSemanticLearningFlushOptions {
  /** Background failures remain durable and observable without blocking a foreground lifecycle boundary. */
  readonly surfaceFailures?: boolean;
}

export interface AgentMemOSSemanticLearningRuntimeOptions {
  readonly memos: MemOS;
  readonly namespace: string;
  readonly sourceRepository: AgentMemorySourceRepository;
  readonly learningRequests: AgentBackgroundLearningRequestLedger;
  readonly modelProvider: () => ResolvedAgentModelProviderConfig;
  readonly policy: () => AgentMemOSSemanticLearningPolicy;
  readonly config: () => AgentMemOSSemanticLearningConfig;
  readonly cacheScopeKey: string;
  readonly logger?: AgentLogger;
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
    validateConfig(options.config());
  }

  start(): void {
    if (this.started || this.stopped) return;
    if (!this.options.policy().enabled) return;
    this.started = true;
    void this.enqueue("startup", async () => {
      const deletionRequests = this.options.learningRequests.listAll({
        board: "semantic_memory",
        stage: "semantic_delete",
      });
      const latestDeletes = new Map<string, (typeof deletionRequests)[number]>();
      for (const record of deletionRequests)
        if (!latestDeletes.has(record.operationKey)) latestDeletes.set(record.operationKey, record);
      for (const record of latestDeletes.values()) {
        if (!this.options.learningRequests.isRecoverable(record, this.options.policy())) continue;
        const references = AgentMemOSDeleteRequestSchema.parse(record.metadata);
        await this.deleteSources(references.episodeUris, references.sourceUris);
      }
      await this.reconcilePersistedTurns();
      await this.reconcilePeriods();
    });
    this.scheduleNextBoundary();
  }

  recordCompletedTurn(recordedTurn: AgentMemoryRecordedTurn): void {
    if (this.stopped) return;
    this.deletedReferences.delete(recordedTurn.episode.uri);
    this.start();
    if (!this.options.policy().enabled || recordedTurn.episode.metadata.stateCard === undefined) return;
    void this.enqueue(recordedTurn.episode.uri, async () => {
      await this.scheduleFragment(recordedTurn);
      await this.reconcilePeriods(completedDate(recordedTurn.episode));
    });
  }

  deleteSources(episodeUris: readonly string[], sourceUris: readonly string[]): Promise<void> {
    if (episodeUris.length === 0 && sourceUris.length === 0) return Promise.resolve();
    for (const reference of [...episodeUris, ...sourceUris]) this.deletedReferences.add(reference);
    const operationKey = `delete:${sha256HexOfCanonicalJson([...episodeUris, ...sourceUris])}`;
    const task = this.enqueue(operationKey, () =>
      this.fragmentTail.then(() =>
        this.runWithRetry(
          {
            operationKey,
            board: "semantic_memory",
            stage: "semantic_delete",
            metadata: { episodeUris: [...episodeUris], sourceUris: [...sourceUris] },
          },
          async () => {
            await this.waitForPeriodTasks();
            const records = this.options.learningRequests.listAll({
              board: "semantic_memory",
              stage: "semantic_fragment",
            });
            const contributions = await Promise.all(
              records.map(async (record) => {
                const fragment = await this.findByTags([
                  AgentMemOSTags.fragment,
                  agentMemOSWriteTag(record.operationKey),
                ]);
                const knowledge = await this.findByTags([
                  AgentMemOSTags.knowledge,
                  agentMemOSWriteTag(record.operationKey),
                ]);
                const edges = fragment ? await this.options.memos.getEdges(fragment.id) : [];
                return {
                  record,
                  ids: unique([
                    ...readNodeIds(record.metadata),
                    ...(fragment ? [fragment.id] : []),
                    ...(knowledge ? [knowledge.id] : []),
                    ...edges
                      .filter((edge) => edge.targetId === fragment?.id && edge.relation === "derived_from")
                      .map((edge) => edge.sourceId),
                  ]),
                };
              }),
            );
            const affected = new Set([...episodeUris, ...sourceUris]);
            const nodeIds = new Set<string>();
            let expanded: boolean;
            do {
              expanded = false;
              for (const { record, ids } of contributions) {
                if (!record.entityUri || (!affected.has(record.entityUri) && !ids.some((id) => nodeIds.has(id))))
                  continue;
                if (!affected.has(record.entityUri)) {
                  affected.add(record.entityUri);
                  expanded = true;
                }
                for (const id of ids)
                  if (!nodeIds.has(id)) {
                    nodeIds.add(id);
                    expanded = true;
                  }
              }
            } while (expanded);
            await Promise.all([...nodeIds].map((nodeId) => this.options.memos.forget(nodeId)));
            const episodes = this.options.sourceRepository
              .listCompletedEpisodes()
              .filter((episode) => affected.has(episode.uri))
              .sort((left, right) => left.completedAtMs - right.completedAtMs || left.id.localeCompare(right.id));
            for (const episode of episodes) {
              await this.learnFragment(
                { episode, sources: this.options.sourceRepository.listSources(episode.uri) },
                true,
              );
            }
            await this.reconcilePeriods();
          },
        ),
      ),
    );
    this.fragmentTail = task.catch(() => {});
    return task;
  }

  async flush(options: AgentMemOSSemanticLearningFlushOptions = {}): Promise<void> {
    while (this.tasks.size > 0) await Promise.allSettled([...this.tasks]);
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
        const nodes = await Promise.all(
          AgentMemOSFragmentCommitSchema.parse(completed.metadata).nodeIds.map((id) => this.options.memos.retrieve(id)),
        );
        if (nodes.length > 0 && nodes.every(Boolean)) return;
        force = true;
      }
    }
    const stateCard = projectStateCard(recordedTurn.episode.metadata.stateCard);
    if (!stateCard) return;
    const model = this.options.modelProvider();
    const config = this.options.config();
    const extractionRecordSchema = createAgentMemOSExtractionRecordSchema(config.digestSummaryTokenLimit);
    await this.withLearningSlot(async () => {
      await this.runWithRetry(
        {
          operationKey,
          board: "semantic_memory",
          stage: "semantic_fragment",
          entityUri: recordedTurn.episode.uri,
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
          const cachedExtraction = cached ? extractionRecordSchema.parse(cached.metadata) : undefined;
          const committedFragment = await this.findByTags([AgentMemOSTags.fragment, agentMemOSWriteTag(operationKey)]);
          if (committedFragment) {
            const contribution = (await this.options.memos.getEdges(committedFragment.id)).find(
              (edge) => edge.targetId === committedFragment.id && edge.relation === "derived_from",
            );
            if (contribution)
              return unique([
                committedFragment.id,
                contribution.sourceId,
                ...(cachedExtraction?.candidateId ? [cachedExtraction.candidateId] : []),
              ]);
          }
          const candidates = cachedExtraction
            ? []
            : await this.findKnowledgeCandidates(
                recordedTurn.episode.standaloneRequest,
                config.knowledgeCandidateLimit,
              );
          const client = new AgentMemOSSemanticModelClient(
            model,
            this.options.cacheScopeKey,
            config.digestSummaryTokenLimit,
          );
          const result: AgentMemOSSemanticFragment = cachedExtraction
            ? client.normalizeFragment(cachedExtraction.fragment)
            : await this.options.learningRequests.run(
                {
                  operationKey,
                  board: "semantic_memory",
                  stage: "semantic_extract",
                  entityUri: recordedTurn.episode.uri,
                  sourceRevision,
                  providerId: model.Id,
                  model: model.Model,
                  attempt,
                },
                () =>
                  client.extractFragment(
                    {
                      user: recordedTurn.episode.rawUserText,
                      assistant: previewForModel(
                        recordedTurn.episode.assistantText,
                        model.Model,
                        config.assistantPreviewTokens,
                      ),
                      stateCard,
                      memoryIntents: projectMemoryIntents(recordedTurn),
                      history: this.projectHistory(recordedTurn.episode, model.Model),
                      candidates: candidates.map(({ ref, summary, type }) => ({ ref, summary, type })),
                    },
                    operationKey,
                    this.shutdown.signal,
                  ),
                (fragment) => ({
                  metadata: extractionRecordSchema.parse({
                    fragment,
                    ...(fragment.candidate === undefined
                      ? {}
                      : { candidateId: candidates[fragment.candidate]?.nodeId }),
                  }),
                }),
              );
          let resolvedResult = result;
          if (cachedExtraction && result.candidate !== undefined) {
            if (!cachedExtraction.candidateId) throw new Error("Persisted MemOS reconciliation is missing its target.");
            const target = await this.options.memos.retrieve(cachedExtraction.candidateId);
            if (!target) {
              throw new Error("The persisted MemOS reconciliation target is no longer available.");
            }
            candidates.push({
              ref: 0,
              nodeId: target.id,
              summary: AgentMemOSSummarySchema.parse(target.summary),
              type: target.type,
            });
            resolvedResult = { ...result, candidate: 0 };
          }
          if (this.deletedReferences.has(recordedTurn.episode.uri)) return [];
          if (!this.isCurrentEpisode(recordedTurn.episode, sourceRevision)) return [];
          return this.reconcileFragment(recordedTurn.episode, resolvedResult, candidates, operationKey);
        },
        (nodeIds) => ({ metadata: AgentMemOSFragmentCommitSchema.parse({ nodeIds }) }),
      );
    });
  }

  private projectHistory(current: AgentMemoryEpisodeRecord, model: string): AgentMemOSFragmentHistoryEntry[] {
    const history = this.options.sourceRepository
      .listEpisodes(current.sessionId)
      .filter((episode) => episode.uri !== current.uri && episode.completedAtMs <= current.startedAtMs)
      .slice()
      .sort((left, right) => right.completedAtMs - left.completedAtMs || right.id.localeCompare(left.id))
      .slice(0, this.options.config().fragmentHistoryTurns)
      .reverse();
    return history.flatMap((episode) => {
      const stateCard = projectStateCard(episode.metadata.stateCard);
      if (!stateCard) return [];
      return {
        user: episode.rawUserText,
        assistant: previewForModel(episode.assistantText, model, this.options.config().assistantPreviewTokens),
        stateCard,
      };
    });
  }

  private async reconcilePersistedTurns(force = false, affected?: ReadonlySet<string>): Promise<void> {
    const persisted = this.options.sourceRepository.listCompletedEpisodes();
    const candidates = persisted
      .filter((episode) => (!affected || affected.has(episode.uri)) && projectStateCard(episode.metadata.stateCard))
      .sort((left, right) => left.completedAtMs - right.completedAtMs || left.id.localeCompare(right.id));
    const limit = this.options.policy().maxJobsPerDrain;
    for (let offset = 0; offset < candidates.length; offset += limit) {
      const batch = candidates.slice(offset, offset + limit);
      await Promise.all(
        batch.map((episode) =>
          this.scheduleFragment(
            {
              episode,
              sources: this.options.sourceRepository.listSources(episode.uri),
            },
            force,
          ),
        ),
      );
    }
  }

  private async reconcileFragment(
    episode: AgentMemoryEpisodeRecord,
    fragment: AgentMemOSSemanticFragment,
    candidates: readonly AgentMemOSSemanticMatch[],
    operationKey: string,
  ): Promise<readonly string[]> {
    if (!this.isCurrentEpisode(episode, fragmentSourceRevision(episode))) return [];
    const writeTag = agentMemOSWriteTag(operationKey);
    const existingKnowledge = await this.findByTags([AgentMemOSTags.semantic, AgentMemOSTags.knowledge, writeTag]);
    const candidate = fragment.candidate === undefined ? undefined : candidates[fragment.candidate];
    if (!existingKnowledge && (fragment.action === "update" || fragment.action === "supersede") && !candidate) {
      throw new Error(`MemOS semantic action ${fragment.action} references an unavailable candidate.`);
    }
    const content = `${fragment.topic}\n${fragment.summary}`;
    let fragmentNode = await this.findByTags([AgentMemOSTags.fragment, writeTag]);
    if (!fragmentNode)
      fragmentNode = (
        await this.options.memos.store(content, {
          type: fragment.type,
          summary: fragment.summary,
          source: "agent_inferred",
          namespace: this.options.namespace,
          validFrom: episode.completedAtMs,
          tags: [
            AgentMemOSTags.semantic,
            AgentMemOSTags.fragment,
            writeTag,
            agentMemOSDayTag(completedDate(episode)),
            agentMemOSMonthTag(agentMemOSLocalMonth(completedDate(episode))),
          ],
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
        tags: replaceAgentMemOSWriteTag(current.tags, writeTag),
      });
      if (!updated) throw new Error(`MemOS candidate ${candidate.nodeId} disappeared before update.`);
      knowledgeId = candidate.nodeId;
    }
    if (!knowledgeId) knowledgeId = (await this.storeKnowledgeNode(episode, fragment, writeTag)).id;
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
    episode: AgentMemoryEpisodeRecord,
    fragment: AgentMemOSSemanticFragment,
    writeTag: string,
  ): Promise<MemoryNode> {
    const stored = await this.options.memos.store(`${fragment.topic}\n${fragment.summary}`, {
      type: fragment.type,
      summary: fragment.summary,
      source: "agent_inferred",
      namespace: this.options.namespace,
      validFrom: episode.completedAtMs,
      tags: [AgentMemOSTags.semantic, AgentMemOSTags.knowledge, writeTag],
    });
    return stored.node;
  }

  private async findKnowledgeCandidates(query: string, limit: number): Promise<AgentMemOSSemanticMatch[]> {
    await this.options.memos.flushEmbeddings();
    const results = await this.options.memos.search({
      query: query.trim(),
      namespace: this.options.namespace,
      tags: [AgentMemOSTags.semantic, AgentMemOSTags.knowledge],
      limit,
      sortBy: "relevance",
      sortOrder: "desc",
    });
    const matches = results.map(({ node }) => ({
      nodeId: node.id,
      summary: AgentMemOSSummarySchema.parse(node.summary),
      type: node.type,
    }));
    return matches.map((match, ref) => ({ ...match, ref }));
  }

  private async reconcilePeriods(singleDate?: string): Promise<void> {
    if (!this.options.policy().enabled) return;
    const today = projectAgentTime(new Date().toISOString(), DefaultAgentTimeZone).localDate;
    const existingDays = singleDate
      ? []
      : await this.listSemanticNodes([AgentMemOSTags.semantic, AgentMemOSTags.dailyDigest]);
    const existingMonths = singleDate
      ? []
      : await this.listSemanticNodes([AgentMemOSTags.semantic, AgentMemOSTags.monthlyDigest]);
    const dates = singleDate
      ? [singleDate]
      : unique(
          this.options.sourceRepository
            .listCompletedEpisodes()
            .map(completedDate)
            .concat(existingDays.map((node) => readAgentMemOSDay(node.tags)))
            .filter((date) => date <= today),
        );
    const eligibleDates = dates.filter((date) => date <= today).sort();
    await Promise.all(
      eligibleDates.map((date) => this.schedulePeriod(agentMemOSDayTag(date), () => this.aggregateDay(date))),
    );
    const months = unique(
      eligibleDates
        .map(agentMemOSLocalMonth)
        .concat(existingMonths.map((node) => readAgentMemOSMonth(node.tags)))
        .filter((month) => month <= agentMemOSLocalMonth(today)),
    );
    await Promise.all(
      months.map((month) => this.schedulePeriod(agentMemOSMonthTag(month), () => this.aggregateMonth(month))),
    );
  }

  private async aggregateDay(localDate: string): Promise<void> {
    const config = this.options.config();
    const model = this.options.modelProvider();
    const periodTag = agentMemOSDayTag(localDate);
    const existing = await this.findByTags([AgentMemOSTags.semantic, AgentMemOSTags.dailyDigest, periodTag]);
    const fragments = await this.listSemanticNodes([AgentMemOSTags.semantic, AgentMemOSTags.fragment, periodTag]);
    if (fragments.length === 0) {
      if (existing) await this.options.memos.forget(existing.id);
      return;
    }
    const entries = fragments
      .map(projectDigestEntry)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    const sourceRevision = digestSourceRevision(entries, {
      inputTokenBudget: config.digestInputTokenBudget,
      summaryTokenLimit: config.digestSummaryTokenLimit,
      providerId: model.Id,
      model: model.Model,
    });
    if (existing && this.hasCompletedLearning("daily_digest", `memos:day:${localDate}`, sourceRevision)) return;
    const summary = await this.summarizeEntries("day", localDate, entries, config, model);
    const tags = [
      AgentMemOSTags.semantic,
      AgentMemOSTags.dailyDigest,
      periodTag,
      agentMemOSMonthTag(agentMemOSLocalMonth(localDate)),
    ];
    await this.runWithRetry(
      {
        operationKey: `memos:day:write:${localDate}`,
        board: "semantic_memory",
        stage: "daily_digest",
        entityUri: `memos:day:${localDate}`,
        sourceRevision,
        providerId: model.Id,
        model: model.Model,
      },
      async () => {
        if (existing) {
          const updated = await this.options.memos.update(existing.id, { content: summary, summary, tags });
          if (!updated) throw new Error(`MemOS daily digest ${existing.id} disappeared before update.`);
          return;
        }
        await this.options.memos.store(summary, {
          type: "context",
          summary,
          source: "agent_inferred",
          namespace: this.options.namespace,
          tags,
        });
      },
    );
  }

  private async aggregateMonth(localMonth: string): Promise<void> {
    const config = this.options.config();
    const model = this.options.modelProvider();
    const periodTag = agentMemOSMonthTag(localMonth);
    const existing = await this.findByTags([AgentMemOSTags.semantic, AgentMemOSTags.monthlyDigest, periodTag]);
    const digests = await this.listSemanticNodes([AgentMemOSTags.semantic, AgentMemOSTags.dailyDigest, periodTag]);
    if (digests.length === 0) {
      if (existing) await this.options.memos.forget(existing.id);
      return;
    }
    const entries = digests
      .map(projectDigestEntry)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    const sourceRevision = digestSourceRevision(entries, {
      inputTokenBudget: config.digestInputTokenBudget,
      summaryTokenLimit: config.digestSummaryTokenLimit,
      providerId: model.Id,
      model: model.Model,
    });
    if (existing && this.hasCompletedLearning("monthly_digest", `memos:month:${localMonth}`, sourceRevision)) return;
    const summary = await this.summarizeEntries("month", localMonth, entries, config, model);
    const tags = [AgentMemOSTags.semantic, AgentMemOSTags.monthlyDigest, periodTag];
    await this.runWithRetry(
      {
        operationKey: `memos:month:write:${localMonth}`,
        board: "semantic_memory",
        stage: "monthly_digest",
        entityUri: `memos:month:${localMonth}`,
        sourceRevision,
        providerId: model.Id,
        model: model.Model,
      },
      async () => {
        if (existing) {
          const updated = await this.options.memos.update(existing.id, { content: summary, summary, tags });
          if (!updated) throw new Error(`MemOS monthly digest ${existing.id} disappeared before update.`);
          return;
        }
        await this.options.memos.store(summary, {
          type: "context",
          summary,
          source: "agent_inferred",
          namespace: this.options.namespace,
          tags,
        });
      },
    );
  }

  private async summarizeEntries(
    period: "day" | "month",
    periodKey: string,
    entries: readonly AgentMemOSDigestEntry[],
    config: AgentMemOSSemanticLearningConfig = this.options.config(),
    model: ResolvedAgentModelProviderConfig = this.options.modelProvider(),
  ): Promise<string> {
    const chunks = splitByTokenBudget(entries, config.digestInputTokenBudget, model.Model);
    const summaries: AgentMemOSDigestEntry[] = [];
    for (let offset = 0; offset < chunks.length; offset += this.options.policy().maxJobsPerDrain) {
      const batch = chunks.slice(offset, offset + this.options.policy().maxJobsPerDrain);
      const results = await Promise.all(
        batch.map((chunk, index) =>
          this.withLearningSlot(() =>
            this.runWithRetry(
              {
                operationKey: `memos:${period}:batch:${periodKey}:${offset + index}`,
                board: "semantic_memory",
                stage: `${period}_digest_batch`,
                entityUri: `senera://memos/${period}/${periodKey}/batch/${offset + index}`,
                sourceRevision: digestSourceRevision(chunk, {
                  inputTokenBudget: config.digestInputTokenBudget,
                  summaryTokenLimit: config.digestSummaryTokenLimit,
                  providerId: model.Id,
                  model: model.Model,
                }),
                providerId: model.Id,
                model: model.Model,
              },
              () =>
                new AgentMemOSSemanticModelClient(
                  model,
                  this.options.cacheScopeKey,
                  config.digestSummaryTokenLimit,
                ).summarizePeriod(
                  { period, periodKey, entries: chunk },
                  `memos:${period}:batch:${periodKey}:${offset + index}`,
                  this.shutdown.signal,
                ),
            ),
          ),
        ),
      );
      summaries.push(
        ...results.map((result, index) => ({
          summary: result.summary,
          type: "context" as const,
          occurredAt: firstEntry(batch, index).occurredAt,
        })),
      );
    }
    if (summaries.length === 1) return summaries[0]!.summary;
    const consolidated = await this.withLearningSlot(() =>
      this.runWithRetry(
        {
          operationKey: `memos:${period}:final:${periodKey}`,
          board: "semantic_memory",
          stage: `${period}_digest_final`,
          entityUri: `senera://memos/${period}/${periodKey}`,
          sourceRevision: digestSourceRevision(summaries, {
            inputTokenBudget: config.digestInputTokenBudget,
            summaryTokenLimit: config.digestSummaryTokenLimit,
            providerId: model.Id,
            model: model.Model,
          }),
          providerId: model.Id,
          model: model.Model,
        },
        () =>
          new AgentMemOSSemanticModelClient(
            model,
            this.options.cacheScopeKey,
            config.digestSummaryTokenLimit,
          ).summarizePeriod(
            { period, periodKey, entries: summaries },
            `memos:${period}:final:${periodKey}`,
            this.shutdown.signal,
          ),
      ),
    );
    return consolidated.summary;
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

  private async findByTags(tags: readonly string[]): Promise<MemoryNode | undefined> {
    const results = await this.options.memos.search({
      namespace: this.options.namespace,
      tags: [...tags],
      limit: 1,
      sortBy: "updatedAt",
      sortOrder: "desc",
    });
    return results[0]?.node;
  }

  private async waitForPeriodTasks(): Promise<void> {
    while (this.periodTasks.size > 0) await Promise.all([...this.periodTasks.values()]);
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

  private isCurrentEpisode(episode: AgentMemoryEpisodeRecord, sourceRevision: string): boolean {
    const current = this.options.sourceRepository.findEpisodesByUris([episode.uri])[0];
    return current !== undefined && fragmentSourceRevision(current) === sourceRevision;
  }

  private hasCompletedLearning(stage: string, entityUri: string, sourceRevision: string): boolean {
    return (
      this.options.learningRequests.list({
        board: "semantic_memory",
        stage,
        entityUri,
        status: "completed",
        sourceRevision,
        limit: 1,
      }).length > 0
    );
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
        this.options.logger?.warn("memory.memos.semantic_learning.failed", { message: errorMessage(error) });
      },
    );
    return tracked;
  }

  private scheduleFragment(recordedTurn: AgentMemoryRecordedTurn, force = false): Promise<void> {
    const key = fragmentTaskKey(recordedTurn.episode);
    const existing = this.fragmentTasks.get(key);
    if (existing) return existing;
    const task = this.track(this.fragmentTail.then(() => this.learnFragment(recordedTurn, force)));
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
    const now = Temporal.Now.zonedDateTimeISO(DefaultAgentTimeZone);
    const next = now.add({ days: 1 }).startOfDay();
    const delay = Math.min(Math.max(0, Number(next.epochMilliseconds) - Date.now()), MaximumTimerDelayMs);
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
