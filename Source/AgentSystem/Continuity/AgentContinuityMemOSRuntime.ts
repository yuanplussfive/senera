import { MemOS, type MemoryNode, type ScoredMemory } from "@mem-os/sdk";
import { AgentMemOSEmbeddingRuntime } from "./AgentMemOSEmbeddingRuntime.js";
import { AgentMemOSRecallDedupe, type AgentMemOSRecallDedupeConfig } from "./AgentMemOSRecallDedupe.js";
import { agentMemOSReference } from "./AgentMemOSReference.js";
import {
  AgentStateCardHistoryLayers,
  type AgentStateCardHistoryTurn,
  AgentStateCardSchemaVersion,
  AgentStateCardToolHistorySchema,
} from "../StateCard/AgentStateCardTypes.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentEmbeddingClient } from "../Vector/AgentEmbeddingContract.js";
import type { AgentMemoryCompletedTurnSink, AgentMemoryDeletionSink } from "../Memory/AgentMemoryService.js";
import type { AgentMemoryDeletionImpact, AgentMemoryRecordedTurn } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentMemorySourceRepository } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentBackgroundLearningRequestLedger } from "../Memory/AgentBackgroundLearningRequestLedger.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentIdentityDisplayValues } from "../Text/AgentTextParts.js";
import type { AgentToolSearchEpisode } from "../ToolSearch/AgentToolSearchMemoryTypes.js";
import {
  AgentMemOSSemanticLearningRuntime,
  type AgentMemOSSemanticLearningFlushOptions,
  type AgentMemOSSemanticLearningConfig,
} from "./AgentMemOSSemanticLearningRuntime.js";
import { AgentMemOSTags, projectAgentMemOSOccurredAt, projectAgentMemOSPeriod } from "./AgentMemOSSemanticTypes.js";

const MemOSTags = {
  ToolRouting: [AgentMemOSTags.toolRouting, AgentMemOSTags.stateCard, AgentStateCardSchemaVersion],
} as const;

export interface AgentContinuityMemOSSearchResult {
  readonly memory: ScoredMemory;
  readonly memoryKey: string;
  readonly deliveryKeys?: readonly string[];
}

export interface AgentContinuityMemOSToolRoutingMemory {
  readonly projectId: string;
  readonly episode: AgentToolSearchEpisode;
  readonly sessionId: string;
  readonly requestId: string;
}

export interface AgentContinuityMemOSRuntimeOptions {
  readonly databasePath: string;
  readonly namespace: string;
  readonly embeddingClient: AgentEmbeddingClient;
  readonly embeddingModel: () => string;
  readonly autoLinkThreshold: number;
  readonly recallDedupeConfig: () => AgentMemOSRecallDedupeConfig;
  readonly sourceRepository: AgentMemorySourceRepository;
  readonly learningRequests: AgentBackgroundLearningRequestLedger;
  readonly semanticModelProvider: () => ResolvedAgentModelProviderConfig;
  readonly semanticPolicy: () => {
    readonly enabled: boolean;
    readonly maxAttempts: number;
    readonly retryBaseMs: number;
    readonly retryMaxDelayMs: number;
    readonly maxJobsPerDrain: number;
  };
  readonly semanticConfig: () => AgentMemOSSemanticLearningConfig;
  readonly semanticScopeKey: string;
  readonly identityDisplayValues?: () => AgentIdentityDisplayValues;
  readonly logger?: AgentLogger;
  /** Dedicated stream for semantic-learning queue, extraction and promotion. */
  readonly learningLogger?: AgentLogger;
}

/**
 * MemOS is the durable memory authority for completed scenarios and routing
 * evidence. The adapter intentionally keeps the rest of the agent
 * runtime independent from the SDK's storage and node shapes.
 */
export class AgentContinuityMemOSRuntime implements AgentMemoryCompletedTurnSink, AgentMemoryDeletionSink {
  private readonly memos: MemOS;
  private readonly namespace: string;
  private ready: Promise<void>;
  private writeTail: Promise<void> = Promise.resolve();
  private semanticCommandTail: Promise<void> = Promise.resolve();
  private writeError: Error | undefined;
  private readonly reportedEmbeddingFailures = new Set<string>();
  private readinessFailureReported = false;
  private closePromise: Promise<void> | undefined;
  private readonly semanticLearning: AgentMemOSSemanticLearningRuntime;
  private readonly recallDedupe: AgentMemOSRecallDedupe;

  constructor(private readonly options: AgentContinuityMemOSRuntimeOptions) {
    this.namespace = requireNonEmpty(options.namespace, "MemOS namespace");
    const embeddingClient = options.embeddingClient;
    const embeddingDimensions = requirePositiveDimension(embeddingClient.dimensions);
    const embeddingModel = requireNonEmpty(options.embeddingModel(), "MemOS embedding model");
    const embeddingProviderId = requireNonEmpty(embeddingClient.providerId ?? "", "MemOS embedding provider");
    this.memos = new AgentMemOSEmbeddingRuntime(
      {
        dbPath: options.databasePath,
        autoLinkThreshold: requireProbability(options.autoLinkThreshold, "MemOS auto-link threshold"),
        experimental: { semanticSearch: true, namespaces: true },
        embeddingQueue: { synchronous: false },
      },
      embeddingClient,
      { id: embeddingProviderId, model: embeddingModel, dimensions: embeddingDimensions },
    );
    this.recallDedupe = new AgentMemOSRecallDedupe({
      memos: this.memos,
      namespace: this.namespace,
      config: options.recallDedupeConfig,
      logger: options.logger,
    });
    this.semanticLearning = new AgentMemOSSemanticLearningRuntime({
      memos: this.memos,
      namespace: this.namespace,
      sourceRepository: options.sourceRepository,
      learningRequests: options.learningRequests,
      modelProvider: options.semanticModelProvider,
      policy: options.semanticPolicy,
      config: options.semanticConfig,
      cacheScopeKey: options.semanticScopeKey,
      identityDisplayValues: options.identityDisplayValues,
      logger: options.learningLogger,
    });
    this.ready = this.memos
      .init()
      .then(() => {
        this.recallDedupe.start();
        this.semanticLearning.start();
      })
      .catch((error) => {
        this.options.logger?.error("memory.memos.init_failed", { message: errorMessage(error) });
        throw error;
      });
    void this.ready.catch(() => {});
  }

  recordCompletedTurn(recordedTurn: AgentMemoryRecordedTurn): void {
    this.semanticCommandTail = this.semanticCommandTail
      .then(() => this.ready)
      .then(() => this.semanticLearning.recordCompletedTurn(recordedTurn))
      .catch((error) => {
        this.writeError ??= toError(error);
        this.options.learningLogger?.warn("memory.memos.semantic_learning.enqueue_failed", {
          message: errorMessage(error),
        });
      });
  }

  readStateCardHistory(sessionId: string): readonly AgentStateCardHistoryTurn[] {
    return this.options.sourceRepository
      .listEpisodes(sessionId)
      .sort((left, right) => left.completedAtMs - right.completedAtMs)
      .slice(-this.options.semanticConfig().fragmentHistoryTurns)
      .map((episode) => {
        try {
          const toolHistory = AgentStateCardToolHistorySchema.optional().parse(episode.metadata.toolHistory);
          return {
            request: episode.rawUserText,
            assistant: episode.assistantText,
            layer: AgentStateCardHistoryLayers.Fine,
            tools: toolHistory?.tools ?? [],
            artifacts: toolHistory?.artifacts ?? [],
          };
        } catch (error) {
          // State-card tool history is derived metadata. Keep the durable
          // request/answer usable when an older record cannot be projected.
          this.options.logger?.warn("memory.memos.state_card_history_projection_failed", {
            sessionId,
            requestId: episode.requestId,
            message: errorMessage(error),
          });
          return {
            request: episode.rawUserText,
            assistant: episode.assistantText,
            layer: AgentStateCardHistoryLayers.Fine,
            tools: [],
            artifacts: [],
          };
        }
      });
  }

  recordToolRoutingMemory(memory: AgentContinuityMemOSToolRoutingMemory): void {
    const projectId = requireNonEmpty(memory.projectId, "MemOS routing project");
    requireNonEmpty(memory.sessionId, "MemOS routing session");
    requireNonEmpty(memory.requestId, "MemOS routing request");
    const episode = memory.episode;
    const routingTag = toolRoutingTag(memory);
    this.enqueue(async () => {
      const query = episode.query.trim();
      const content = JSON.stringify(episode);
      const existing = await this.findRoutingTag(routingTag);
      if (existing?.content === content) return;
      const finalScore = episode.finalScore;
      if (!Number.isFinite(finalScore) || finalScore < 0 || finalScore > 1) {
        throw new Error("Tool routing finalScore must be between 0 and 1.");
      }
      const tags = [
        ...MemOSTags.ToolRouting,
        `project:${encodeURIComponent(projectId)}`,
        routingTag,
        toolRoutingSessionTag(memory.sessionId),
        toolRoutingRequestTag(memory.requestId),
      ];
      if (existing) {
        const updated = await this.memos.update(existing.id, { content, summary: query, trustScore: finalScore, tags });
        if (!updated) throw new Error(`MemOS routing node ${existing.id} disappeared before update.`);
        return;
      }
      await this.memos.store(content, {
        type: "context",
        ...(query ? { summary: query } : {}),
        source: "agent_inferred",
        trustScore: finalScore,
        namespace: this.namespace,
        validFrom: episode.timestamp,
        tags,
      });
    });
  }

  async searchToolRouting(
    query: string,
    projectId: string,
    limit: number,
  ): Promise<AgentContinuityMemOSSearchResult[]> {
    const normalizedProjectId = projectId.trim();
    const resolvedLimit = positiveLimit(limit);
    if (!normalizedProjectId || resolvedLimit === 0) return [];
    if (!(await this.awaitReadable())) return [];
    const results = await this.memos.search({
      query: query.trim() || undefined,
      namespace: this.namespace,
      tags: [...MemOSTags.ToolRouting, `project:${encodeURIComponent(normalizedProjectId)}`],
      limit: resolvedLimit,
      sortBy: query.trim() ? "relevance" : "createdAt",
      sortOrder: "desc",
    });
    return results.map((memory) => ({ memory, memoryKey: memoryKey(memory) }));
  }

  async listToolRouting(projectId: string, limit: number): Promise<AgentContinuityMemOSSearchResult[]> {
    const normalizedProjectId = projectId.trim();
    const resolvedLimit = positiveLimit(limit);
    if (!normalizedProjectId || resolvedLimit === 0) return [];
    if (!(await this.awaitReadable())) return [];
    const results = await this.memos.search({
      namespace: this.namespace,
      tags: [...MemOSTags.ToolRouting, `project:${encodeURIComponent(normalizedProjectId)}`],
      limit: resolvedLimit,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
    return results.map((memory) => ({ memory, memoryKey: memoryKey(memory) }));
  }

  async search(
    query: string,
    options: { readonly excludedKeys?: ReadonlySet<string> } = {},
  ): Promise<AgentContinuityMemOSSearchResult[]> {
    const normalized = query.trim();
    if (!normalized) return [];
    return this.readRecall(() => this.searchSemantic(normalized), options.excludedKeys);
  }

  /** Returns the newest MemOS memories for an empty-query turn. */
  async searchRecent(
    options: {
      readonly excludedKeys?: ReadonlySet<string>;
    } = {},
  ): Promise<AgentContinuityMemOSSearchResult[]> {
    return this.readRecall(() => this.searchSemantic(""), options.excludedKeys);
  }

  /** Filter before token selection; exact references bypass ranked search. */
  async recall(input: {
    readonly query?: string;
    readonly nodeIds?: readonly string[];
    readonly range?: { readonly startMs: number; readonly endMs: number };
  }): Promise<AgentContinuityMemOSSearchResult[]> {
    const nodeIds = input.nodeIds ?? [];
    const read = async (): Promise<ScoredMemory[]> => {
      let results: ScoredMemory[];
      if (nodeIds.length > 0) {
        results = (
          await Promise.all(
            nodeIds.map(async (nodeId) => {
              const node = await this.memos.retrieve(nodeId);
              return node && node.namespace === this.namespace && node.tags.includes(AgentMemOSTags.semantic)
                ? { node, score: node.trustScore }
                : undefined;
            }),
          )
        ).filter((result): result is ScoredMemory => result !== undefined);
      } else if (input.range) {
        results = await this.memos.search({
          query: input.query?.trim() || undefined,
          namespace: this.namespace,
          tags: [AgentMemOSTags.semantic],
          includeHistorical: true,
          limit: Math.max(this.memos.count, 1),
          sortBy: input.query?.trim() ? "relevance" : "createdAt",
          sortOrder: "desc",
        });
      } else results = await this.searchSemantic(input.query?.trim() ?? "");
      const range = input.range;
      const selected = results.filter(({ node }) => {
        if (!range) return true;
        const period = projectAgentMemOSPeriod(node.tags);
        if (period) return Date.parse(period.start) < range.endMs && Date.parse(period.end) > range.startMs;
        const occurredAt = Date.parse(projectAgentMemOSOccurredAt(node));
        return occurredAt >= range.startMs && occurredAt < range.endMs;
      });
      if (!input.query?.trim())
        selected.sort(
          (left, right) =>
            Date.parse(projectAgentMemOSOccurredAt(right.node)) - Date.parse(projectAgentMemOSOccurredAt(left.node)) ||
            left.node.id.localeCompare(right.node.id),
        );
      return selected;
    };
    if (nodeIds.length > 0) {
      if (!(await this.awaitReadable())) return [];
      return (await read()).map((memory) => ({ memory, memoryKey: memoryKey(memory) }));
    }
    return this.readRecall(read);
  }

  private projectRecall(
    results: readonly ScoredMemory[],
    excluded?: ReadonlySet<string>,
  ): AgentContinuityMemOSSearchResult[] {
    return results.flatMap((memory) => {
      const projected = this.recallDedupe.project(memory, excluded);
      return projected ? [{ ...projected, memoryKey: memoryKey(memory) }] : [];
    });
  }

  /** Background learning can update a node while the hybrid query awaits its encoder. */
  private async readRecall(
    read: () => Promise<ScoredMemory[]>,
    excluded?: ReadonlySet<string>,
  ): Promise<AgentContinuityMemOSSearchResult[]> {
    let results: ScoredMemory[];
    let generation: number;
    do {
      if (!(await this.awaitReadable())) return [];
      await this.recallDedupe.synchronize();
      generation = this.recallDedupe.generation;
      results = await read();
    } while (generation !== this.recallDedupe.generation);
    return this.projectRecall(results, excluded);
  }

  private async searchSemantic(query: string): Promise<ScoredMemory[]> {
    const limit = Math.max(this.memos.count, 1);
    const groups = await Promise.all(
      [AgentMemOSTags.knowledge, AgentMemOSTags.dailyDigest, AgentMemOSTags.monthlyDigest].map((kind) =>
        this.memos.search({
          query: query || undefined,
          namespace: this.namespace,
          tags: [AgentMemOSTags.semantic, kind],
          limit,
          sortBy: query ? "relevance" : "createdAt",
          sortOrder: "desc",
        }),
      ),
    );
    return groups
      .flat()
      .sort((left, right) =>
        query
          ? right.score - left.score || left.node.id.localeCompare(right.node.id)
          : Date.parse(projectAgentMemOSOccurredAt(right.node)) - Date.parse(projectAgentMemOSOccurredAt(left.node)) ||
            left.node.id.localeCompare(right.node.id),
      );
  }

  deleteSources(impact: AgentMemoryDeletionImpact): void {
    if (
      impact.sourceUris.length === 0 &&
      impact.episodeUris.length === 0 &&
      (impact.requestIds?.length ?? 0) === 0 &&
      !impact.requestId
    )
      return;
    this.semanticCommandTail = this.semanticCommandTail
      .then(() => this.ready)
      .then(async () => {
        await this.semanticLearning.deleteSources(impact.episodeUris, impact.sourceUris);
        const requestIds = [
          ...new Set([...(impact.requestIds ?? []), ...(impact.requestId ? [impact.requestId] : [])]),
        ];
        await this.deleteRoutingTags(requestIds.map(toolRoutingRequestTag));
      })
      .catch((error) => {
        this.writeError ??= toError(error);
        this.options.learningLogger?.warn("memory.memos.semantic_learning.delete_failed", {
          message: errorMessage(error),
        });
      });
  }

  deleteSession(sessionId: string): void {
    const normalized = sessionId.trim();
    if (!normalized) return;
    this.semanticCommandTail = this.semanticCommandTail
      .then(() => this.ready)
      .then(() => this.deleteRoutingTags([toolRoutingSessionTag(normalized)]))
      .catch((error) => {
        this.writeError ??= toError(error);
        this.options.learningLogger?.warn("memory.memos.routing_learning.delete_failed", {
          message: errorMessage(error),
        });
      });
  }

  /**
   * Drains continuity work without turning detached learning failures into a
   * foreground run failure. Callers that own an explicit maintenance boundary
   * can opt into promotion with `surfaceFailures: true`.
   */
  async flush(options: AgentMemOSSemanticLearningFlushOptions = {}): Promise<void> {
    const surfaceFailures = options.surfaceFailures === true;
    await this.writeTail;
    await this.semanticCommandTail;
    if (!(await this.awaitReady(surfaceFailures))) return;
    try {
      await this.semanticLearning.flush({ surfaceFailures });
    } catch (error) {
      if (surfaceFailures) throw error;
      this.options.learningLogger?.warn("memory.memos.semantic_learning.flush_failed", {
        message: errorMessage(error),
      });
    }
    try {
      await this.awaitReadable({ surfaceFailures });
    } catch (error) {
      if (surfaceFailures) throw error;
      this.options.logger?.warn("memory.memos.readiness.flush_failed", {
        message: errorMessage(error),
      });
    }
    try {
      await this.recallDedupe.synchronize({ surfaceFailures });
    } catch (error) {
      if (surfaceFailures) throw error;
      this.options.logger?.warn("memory.memos.recall_dedupe.flush_failed", {
        message: errorMessage(error),
      });
    }
  }

  close(): Promise<void> {
    return (this.closePromise ??= (async () => {
      let failure: unknown;
      try {
        await this.flush();
      } catch (error) {
        failure = error;
      } finally {
        try {
          await this.semanticLearning.stop({ surfaceFailures: false });
        } finally {
          try {
            await this.recallDedupe.stop();
          } finally {
            await this.memos.close();
          }
        }
      }
      if (failure) throw failure;
    })());
  }

  private enqueue(operation: () => Promise<void>): void {
    this.writeTail = this.writeTail
      .then(async () => {
        await this.ready;
        await operation();
      })
      .catch((error) => {
        const failure = toError(error);
        this.writeError ??= failure;
        this.options.logger?.error("memory.memos.write_failed", { message: failure.message });
      });
  }

  private async awaitReadable(options: { readonly surfaceFailures?: boolean } = {}): Promise<boolean> {
    const surfaceFailures = options.surfaceFailures === true;
    if (!(await this.awaitReady(surfaceFailures))) return false;
    await this.writeTail;
    if (this.writeError) {
      const error = this.writeError;
      this.writeError = undefined;
      if (surfaceFailures) throw error;
      this.options.logger?.warn("memory.memos.detached_write_failed", { message: error.message });
    }
    try {
      await this.memos.flushEmbeddings();
    } catch (error) {
      if (surfaceFailures) throw error;
      this.options.logger?.warn("memory.memos.embedding_flush_failed", { message: errorMessage(error) });
      return false;
    }
    if (surfaceFailures) this.assertEmbeddingsHealthy();
    else this.reportEmbeddingFailures();
    return true;
  }

  private async awaitReady(surfaceFailures: boolean): Promise<boolean> {
    try {
      await this.ready;
      return true;
    } catch (error) {
      if (surfaceFailures) throw error;
      if (!this.readinessFailureReported) {
        this.readinessFailureReported = true;
        this.options.logger?.warn("memory.memos.readiness_suppressed", { message: errorMessage(error) });
      }
      return false;
    }
  }

  private async findRoutingTag(routingTag: string): Promise<MemoryNode | undefined> {
    const existing = await this.memos.search({
      namespace: this.namespace,
      tags: [...MemOSTags.ToolRouting, routingTag],
      limit: 1,
    });
    return existing[0]?.node;
  }

  private async deleteRoutingTags(tags: readonly string[]): Promise<void> {
    const limit = this.memos.count;
    if (limit === 0) return;
    for (const tag of tags) {
      const matches = await this.memos.search({
        namespace: this.namespace,
        tags: [...MemOSTags.ToolRouting, tag],
        limit,
      });
      await Promise.all(matches.map((match) => this.memos.forget(match.node.id)));
    }
  }

  private assertEmbeddingsHealthy(): void {
    const failed = this.memos
      .embeddingStatus()
      .nodes.filter((node) => node.status === "failed" && node.lastError)
      .map((node) => `${node.nodeId}: ${node.lastError}`);
    if (failed.length > 0) {
      throw new Error(`MemOS embedding queue has failed nodes: ${failed.join("; ")}`);
    }
  }

  private reportEmbeddingFailures(): void {
    const failures = this.memos
      .embeddingStatus()
      .nodes.filter((node) => node.status === "failed" && node.lastError)
      .map((node) => ({ nodeId: node.nodeId, message: node.lastError! }));
    const current = new Set(failures.map(({ nodeId, message }) => `${nodeId}:${message}`));
    for (const key of this.reportedEmbeddingFailures) {
      if (!current.has(key)) this.reportedEmbeddingFailures.delete(key);
    }
    for (const failure of failures) {
      const key = `${failure.nodeId}:${failure.message}`;
      if (this.reportedEmbeddingFailures.has(key)) continue;
      this.reportedEmbeddingFailures.add(key);
      this.options.logger?.warn("memory.memos.embedding_failed", failure);
    }
  }
}

function memoryKey(memory: ScoredMemory): string {
  return agentMemOSReference(memory.node.id);
}

function toolRoutingTag(memory: AgentContinuityMemOSToolRoutingMemory): string {
  const digest = sha256HexOfCanonicalJson({
    projectId: memory.projectId,
    sessionId: memory.sessionId,
    requestId: memory.requestId,
  }).slice(0, 32);
  return `routing:${digest}`;
}

function toolRoutingSessionTag(sessionId: string): string {
  return `routing-session:${sha256HexOfCanonicalJson(sessionId).slice(0, 32)}`;
}

function toolRoutingRequestTag(requestId: string): string {
  return `routing-request:${sha256HexOfCanonicalJson(requestId).slice(0, 32)}`;
}

function positiveLimit(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  return normalized;
}

function requirePositiveDimension(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error("MemOS embedding client must expose a positive integer dimensions value.");
  }
  return value;
}

function requireProbability(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a number between 0 and 1.`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
