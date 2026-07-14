import {
  resolveModelProviderConfig,
  resolveMemoryLearningConfig,
  resolveToolLearningConfig,
  resolveVectorModelsConfig,
} from "../AgentDefaults.js";
import { AgentActionPlannerModelClient } from "../ActionPlanner/AgentActionPlannerModelClient.js";
import type { AgentSystemConfig, ResolvedAgentMemoryLearningConfig } from "../Types/AgentConfigTypes.js";
import { AgentVectorModelClient } from "../Vector/AgentVectorModelClient.js";
import {
  type AgentMemoryCandidateDraft,
  type AgentMemoryCandidateRecord,
  type AgentMemoryConsolidationActionRecord,
  type AgentMemoryLearningJobRecord,
  type AgentMemoryRecordedTurn,
  type AgentMemorySourceRepository,
} from "./AgentMemorySourceRepository.js";
import { AgentMemoryWriteResolver } from "./AgentMemoryWriteResolver.js";
import {
  buildMemoryConsolidationPromptInput,
  buildMemoryLearningPromptInput,
  candidateSourceRefs,
} from "./AgentMemoryLearningPromptProjector.js";
import {
  type AgentMemoryLearningVectorClient,
  rankSimilarPendingCandidates,
  recordMemoryItemEmbeddings,
  withMemoryCandidateEmbeddings,
} from "./AgentMemoryLearningVectorRuntime.js";
import { AgentMemoryLearningModelClient } from "./AgentMemoryLearningModelClient.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type {
  AgentMemoryConsolidationPromptInput,
  AgentMemoryLearningPromptInput,
} from "../ActionPlanner/AgentLearningPromptJson.js";

export { buildMemoryLearningPromptInput } from "./AgentMemoryLearningPromptProjector.js";

export interface AgentMemoryLearningClient {
  learnAndValidate(
    input: AgentMemoryLearningPromptInput,
    options: {
      supportingSourceRefs: readonly string[];
    },
  ): Promise<{ candidates: AgentMemoryCandidateDraft[] }>;
  consolidateAndValidate(
    input: AgentMemoryConsolidationPromptInput,
    options: {
      candidateSources: ReadonlyMap<string, readonly string[]>;
      existingMemoryUris: readonly string[];
    },
  ): Promise<{ actions: AgentMemoryConsolidationActionRecord[] }>;
}

export interface AgentMemoryWriteDecisionResolver {
  resolve(input: {
    source: "automatic_learning";
    requestId: string;
    standaloneRequest: string;
    proposed: AgentMemoryConsolidationActionRecord;
  }): Promise<AgentMemoryConsolidationActionRecord>;
}

export interface AgentMemoryLearningRuntimeDependencies {
  learningClient: AgentMemoryLearningClient;
  vectorClient: AgentMemoryLearningVectorClient;
  writeResolver: AgentMemoryWriteDecisionResolver;
}

export type AgentMemoryLearningRuntimeDependencyFactory = (input: {
  systemConfig: AgentSystemConfig;
  learningConfig: ReturnType<typeof resolveToolLearningConfig>;
  memoryLearningConfig: ResolvedAgentMemoryLearningConfig;
}) => AgentMemoryLearningRuntimeDependencies;

export interface AgentMemoryLearningRuntimeOptions {
  repository: AgentMemorySourceRepository;
  configSnapshot: () => AgentSystemConfig;
  logger?: AgentLogger;
  createDependencies?: AgentMemoryLearningRuntimeDependencyFactory;
  now?: () => number;
  retryBaseMs?: number;
  maxAttempts?: number;
}

export class AgentMemoryLearningRuntime {
  private static readonly BatchSize = 4;
  private static readonly DefaultRetryBaseMs = 5_000;
  private static readonly MaxRetryDelayMs = 5 * 60_000;
  private static readonly DefaultMaxAttempts = 5;
  private readonly recordedTurns = new Map<string, AgentMemoryRecordedTurn>();
  private started = false;
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private drainPromise?: Promise<void>;

  constructor(private readonly options: AgentMemoryLearningRuntimeOptions) {}

  start(): void {
    if (this.started && !this.stopped) return;
    this.started = true;
    this.stopped = false;
    this.options.repository.resetRunningMemoryLearningJobs(this.now());
    this.scheduleNextDrain();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  enqueue(recordedTurn: AgentMemoryRecordedTurn): void {
    const now = this.now();
    this.recordedTurns.set(recordedTurn.episode.uri, recordedTurn);
    this.options.repository.enqueueMemoryLearningJob(recordedTurn.episode.uri, now);
    this.scheduleNextDrain();
  }

  drainDue(): Promise<void> {
    if (this.drainPromise) return this.drainPromise;
    this.drainPromise = this.runDueJobs().finally(() => {
      this.drainPromise = undefined;
      this.scheduleNextDrain();
    });
    return this.drainPromise;
  }

  async learn(recordedTurn: AgentMemoryRecordedTurn): Promise<void> {
    const systemConfig = this.options.configSnapshot();
    const learningConfig = resolveToolLearningConfig(systemConfig);
    const memoryLearningConfig = resolveMemoryLearningConfig(systemConfig);
    if (!learningConfig.Enabled) {
      return;
    }

    const { learningClient, vectorClient, writeResolver } = this.createDependencies({
      systemConfig,
      learningConfig,
      memoryLearningConfig,
    });
    const recordedCandidates = await this.loadOrCreateCandidates(recordedTurn, learningClient, vectorClient);
    if (recordedCandidates.length === 0) return;
    const pendingCandidates = this.pendingRecordedCandidates(recordedTurn, recordedCandidates);

    await this.absorbCandidatesAgainstActiveMemories({
      writeResolver,
      vectorClient,
      recordedTurn,
      candidates: pendingCandidates,
    });

    await this.promoteReadyCandidates({
      learningClient,
      vectorClient,
      writeResolver,
      memoryLearningConfig,
      recordedTurn,
      candidates: this.pendingRecordedCandidates(recordedTurn, pendingCandidates),
    });
  }

  private async runDueJobs(): Promise<void> {
    if (!this.started || this.stopped) return;
    const jobs = this.options.repository.listDueMemoryLearningJobs(this.now(), AgentMemoryLearningRuntime.BatchSize);
    for (const job of jobs) {
      if (this.stopped) return;
      await this.runJob(job);
    }
  }

  private async runJob(job: AgentMemoryLearningJobRecord): Promise<void> {
    const claimed = this.options.repository.markMemoryLearningJobRunning(job.episodeUri, this.now());
    if (!claimed) return;
    const recordedTurn = this.recordedTurns.get(job.episodeUri) ?? this.hydrateRecordedTurn(job.episodeUri);
    if (!recordedTurn) {
      this.options.repository.markMemoryLearningJobFailed(job.episodeUri, {
        terminal: true,
        nextAttemptAtMs: this.now(),
        lastError: "memory learning episode is missing",
        updatedAtMs: this.now(),
      });
      this.recordedTurns.delete(job.episodeUri);
      return;
    }

    try {
      await this.learn(recordedTurn);
      this.options.repository.markMemoryLearningJobCompleted(job.episodeUri, this.now());
      this.recordedTurns.delete(job.episodeUri);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const terminal = claimed.attempts >= (this.options.maxAttempts ?? AgentMemoryLearningRuntime.DefaultMaxAttempts);
      const delay = this.retryDelay(claimed.attempts);
      const now = this.now();
      this.options.repository.markMemoryLearningJobFailed(job.episodeUri, {
        terminal,
        nextAttemptAtMs: terminal ? now : now + delay,
        lastError: message,
        updatedAtMs: now,
      });
      this.options.logger?.warn("memory.learning.failed", {
        message,
        requestId: recordedTurn.episode.requestId,
        standaloneRequest: recordedTurn.episode.standaloneRequest,
        attempt: claimed.attempts,
        terminal,
        retryInMs: terminal ? 0 : delay,
      });
      if (terminal) this.recordedTurns.delete(job.episodeUri);
    }
  }

  private async loadOrCreateCandidates(
    recordedTurn: AgentMemoryRecordedTurn,
    learningClient: AgentMemoryLearningClient,
    vectorClient: AgentMemoryLearningVectorClient,
  ): Promise<AgentMemoryCandidateRecord[]> {
    const existing = this.options.repository.listMemoryCandidatesForEpisode(recordedTurn.episode.uri);
    if (existing.length > 0) return existing;

    const learningInput = buildMemoryLearningPromptInput(recordedTurn);
    const learned = await learningClient.learnAndValidate(learningInput, {
      supportingSourceRefs: learningInput.supportingSourceRefs,
    });
    if (learned.candidates.length === 0) {
      this.options.logger?.info("memory.learning.skipped", {
        reason: "BAML returned no durable memory candidates",
        requestId: recordedTurn.episode.requestId,
      });
      return [];
    }

    const candidates = await withMemoryCandidateEmbeddings(vectorClient, learned.candidates);
    const recorded = this.options.repository.recordMemoryCandidates({
      episode: recordedTurn.episode,
      candidates,
    });
    this.options.logger?.info("memory.learning.candidates_recorded", {
      requestId: recordedTurn.episode.requestId,
      count: recorded.length,
      candidateUris: recorded.map((candidate) => candidate.uri),
    });
    return recorded;
  }

  private hydrateRecordedTurn(episodeUri: string): AgentMemoryRecordedTurn | undefined {
    const episode = this.options.repository.findEpisodesByUris([episodeUri])[0];
    return episode
      ? {
          episode,
          sources: this.options.repository.listSources(episodeUri),
        }
      : undefined;
  }

  private scheduleNextDrain(): void {
    if (!this.started || this.stopped || this.drainPromise) return;
    const nextAt = this.options.repository.nextMemoryLearningJobAtMs();
    if (nextAt === undefined) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        void this.drainDue();
      },
      Math.max(0, nextAt - this.now()),
    );
    this.timer.unref();
  }

  private retryDelay(attempt: number): number {
    const base = this.options.retryBaseMs ?? AgentMemoryLearningRuntime.DefaultRetryBaseMs;
    return Math.min(AgentMemoryLearningRuntime.MaxRetryDelayMs, base * 2 ** Math.max(0, attempt - 1));
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private async absorbCandidatesAgainstActiveMemories(input: {
    writeResolver: AgentMemoryWriteDecisionResolver;
    vectorClient: AgentMemoryLearningVectorClient;
    recordedTurn: AgentMemoryRecordedTurn;
    candidates: readonly AgentMemoryCandidateRecord[];
  }): Promise<void> {
    for (const candidate of input.candidates) {
      const decision = await input.writeResolver.resolve({
        source: "automatic_learning",
        requestId: input.recordedTurn.episode.requestId,
        standaloneRequest: input.recordedTurn.episode.standaloneRequest,
        proposed: candidateToProposedWrite(candidate),
      });
      if (decision.operation === "create") {
        continue;
      }

      const written = this.options.repository.applyMemoryLearning({
        episode: input.recordedTurn.episode,
        actions: [decision],
      });
      await recordMemoryItemEmbeddings(input.vectorClient, this.options.repository, written).catch((error) => {
        this.options.logger?.warn("memory.learning.embedding_skipped", {
          requestId: input.recordedTurn.episode.requestId,
          message: error instanceof Error ? error.message : String(error),
        });
      });
      this.options.logger?.info("memory.learning.candidate_absorbed", {
        requestId: input.recordedTurn.episode.requestId,
        operation: decision.operation,
        candidateUri: candidate.uri,
        targetMemoryUri: decision.targetMemoryUri ?? "",
        memoryUris: written.map((item) => item.uri),
      });
    }
  }

  private pendingRecordedCandidates(
    recordedTurn: AgentMemoryRecordedTurn,
    candidates: readonly AgentMemoryCandidateRecord[],
  ): AgentMemoryCandidateRecord[] {
    const pendingUris = new Set(
      this.options.repository
        .listPendingMemoryCandidates(recordedTurn.episode.sessionId)
        .map((candidate) => candidate.uri),
    );
    return candidates.filter((candidate) => pendingUris.has(candidate.uri));
  }

  private async promoteReadyCandidates(input: {
    learningClient: AgentMemoryLearningClient;
    vectorClient: AgentMemoryLearningVectorClient;
    writeResolver: AgentMemoryWriteDecisionResolver;
    memoryLearningConfig: ResolvedAgentMemoryLearningConfig;
    recordedTurn: AgentMemoryRecordedTurn;
    candidates: readonly AgentMemoryCandidateRecord[];
  }): Promise<void> {
    for (const candidate of input.candidates) {
      const pending = this.options.repository.listPendingMemoryCandidates(
        input.recordedTurn.episode.sessionId,
        candidate.type,
      );
      if (!pending.some((item) => item.uri === candidate.uri)) {
        continue;
      }
      const cluster = await rankSimilarPendingCandidates(
        input.vectorClient,
        input.memoryLearningConfig,
        candidate,
        pending,
      );
      if (cluster.length < input.memoryLearningConfig.Promotion.MinSupport) {
        continue;
      }

      const existingMemories = this.options.repository.listActiveMemoryItems();
      const consolidationInput = buildMemoryConsolidationPromptInput(input.recordedTurn, cluster, existingMemories);
      const consolidated = await input.learningClient.consolidateAndValidate(consolidationInput, {
        candidateSources: candidateSourceRefs(cluster),
        existingMemoryUris: consolidationInput.existingMemories.map((memory) => memory.uri),
      });

      if (consolidated.actions.length === 0) {
        continue;
      }

      const resolvedActions: AgentMemoryConsolidationActionRecord[] = [];
      for (const action of consolidated.actions) {
        resolvedActions.push(
          await input.writeResolver.resolve({
            source: "automatic_learning",
            requestId: input.recordedTurn.episode.requestId,
            standaloneRequest: input.recordedTurn.episode.standaloneRequest,
            proposed: action,
          }),
        );
      }

      const written = this.options.repository.applyMemoryLearning({
        episode: input.recordedTurn.episode,
        actions: resolvedActions,
      });
      await recordMemoryItemEmbeddings(input.vectorClient, this.options.repository, written).catch((error) => {
        this.options.logger?.warn("memory.learning.embedding_skipped", {
          requestId: input.recordedTurn.episode.requestId,
          message: error instanceof Error ? error.message : String(error),
        });
      });
      this.options.logger?.info("memory.learning.promoted", {
        requestId: input.recordedTurn.episode.requestId,
        count: written.length,
        operations: resolvedActions.map((action) => action.operation),
        memoryUris: written.map((item) => item.uri),
        candidateUris: cluster.map((item) => item.uri),
      });
    }
  }

  private createDependencies(input: {
    systemConfig: AgentSystemConfig;
    learningConfig: ReturnType<typeof resolveToolLearningConfig>;
    memoryLearningConfig: ResolvedAgentMemoryLearningConfig;
  }): AgentMemoryLearningRuntimeDependencies {
    if (this.options.createDependencies) {
      return this.options.createDependencies(input);
    }

    const model = resolveModelProviderConfig(input.systemConfig);
    const vectorConfig = resolveVectorModelsConfig(input.systemConfig);
    const client = new AgentActionPlannerModelClient(model, input.learningConfig.Client, {
      maxRepairAttempts: input.learningConfig.MaxRepairAttempts,
    });
    const vectorClient = new AgentVectorModelClient(vectorConfig);
    return {
      learningClient: new AgentMemoryLearningModelClient({
        client,
        maxRepairAttempts: input.learningConfig.MaxRepairAttempts,
      }),
      vectorClient,
      writeResolver: new AgentMemoryWriteResolver({
        repository: this.options.repository,
        client,
        vectorClient,
        memoryLearningConfig: input.memoryLearningConfig,
        embeddingModel: vectorConfig.Embedding.Model,
        maxRepairAttempts: input.learningConfig.MaxRepairAttempts,
      }),
    };
  }
}

export function candidateToProposedMemoryWrite(
  candidate: AgentMemoryCandidateRecord,
): AgentMemoryConsolidationActionRecord {
  return {
    operation: "create",
    type: candidate.type,
    subject: candidate.subject,
    claim: candidate.claim,
    howToApply: candidate.howToApply,
    tags: candidate.tags,
    triggers: candidate.triggers,
    sourceRefs: candidate.sourceRefs,
    candidateUris: [candidate.uri],
    reason: candidate.reason,
    confidence: candidate.confidence,
  };
}

function candidateToProposedWrite(candidate: AgentMemoryCandidateRecord): AgentMemoryConsolidationActionRecord {
  return candidateToProposedMemoryWrite(candidate);
}
