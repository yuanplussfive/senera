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
}

export class AgentMemoryLearningRuntime {
  constructor(private readonly options: AgentMemoryLearningRuntimeOptions) {}

  enqueue(recordedTurn: AgentMemoryRecordedTurn): void {
    void this.learn(recordedTurn).catch((error) => {
      this.options.logger?.warn("memory.learning.failed", {
        message: error instanceof Error ? error.message : String(error),
        requestId: recordedTurn.episode.requestId,
        standaloneRequest: recordedTurn.episode.standaloneRequest,
      });
    });
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
    const learningInput = buildMemoryLearningPromptInput(recordedTurn);
    const learned = await learningClient.learnAndValidate(learningInput, {
      supportingSourceRefs: learningInput.supportingSourceRefs,
    });

    if (learned.candidates.length === 0) {
      this.options.logger?.info("memory.learning.skipped", {
        reason: "BAML returned no durable memory candidates",
        requestId: recordedTurn.episode.requestId,
      });
      return;
    }

    const candidates = await withMemoryCandidateEmbeddings(vectorClient, learned.candidates);
    const recordedCandidates = this.options.repository.recordMemoryCandidates({
      episode: recordedTurn.episode,
      candidates,
    });
    this.options.logger?.info("memory.learning.candidates_recorded", {
      requestId: recordedTurn.episode.requestId,
      count: recordedCandidates.length,
      candidateUris: recordedCandidates.map((candidate) => candidate.uri),
    });

    await this.absorbCandidatesAgainstActiveMemories({
      writeResolver,
      vectorClient,
      recordedTurn,
      candidates: recordedCandidates,
    });

    await this.promoteReadyCandidates({
      learningClient,
      vectorClient,
      writeResolver,
      memoryLearningConfig,
      recordedTurn,
      candidates: this.pendingRecordedCandidates(recordedTurn, recordedCandidates),
    });
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
