import {
  resolveModelProviderConfig,
  resolveMemoryLearningConfig,
  resolveToolLearningConfig,
  resolveVectorModelsConfig,
} from "../AgentDefaults.js";
import { AgentActionPlannerModelClient } from "../ActionPlanner/AgentActionPlannerModelClient.js";
import type {
  AgentSystemConfig,
  ResolvedAgentMemoryLearningConfig,
} from "../Types/AgentConfigTypes.js";
import { AgentVectorModelClient } from "../Vector/AgentVectorModelClient.js";
import {
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
  rankSimilarPendingCandidates,
  recordMemoryItemEmbeddings,
  withMemoryCandidateEmbeddings,
} from "./AgentMemoryLearningVectorRuntime.js";
import { AgentMemoryLearningModelClient } from "./AgentMemoryLearningModelClient.js";

export { buildMemoryLearningPromptInput } from "./AgentMemoryLearningPromptProjector.js";

export interface AgentMemoryLearningRuntimeOptions {
  repository: AgentMemorySourceRepository;
  configSnapshot: () => AgentSystemConfig;
}

export class AgentMemoryLearningRuntime {
  constructor(private readonly options: AgentMemoryLearningRuntimeOptions) {}

  enqueue(recordedTurn: AgentMemoryRecordedTurn): void {
    void this.learn(recordedTurn).catch((error) => {
      console.warn("[memory-learning] failed", {
        message: error instanceof Error ? error.message : String(error),
        requestId: recordedTurn.episode.requestId,
        standaloneRequest: recordedTurn.episode.standaloneRequest,
      });
    });
  }

  private async learn(recordedTurn: AgentMemoryRecordedTurn): Promise<void> {
    const systemConfig = this.options.configSnapshot();
    const learningConfig = resolveToolLearningConfig(systemConfig);
    const memoryLearningConfig = resolveMemoryLearningConfig(systemConfig);
    if (!learningConfig.Enabled) {
      return;
    }

    const model = resolveModelProviderConfig(systemConfig);
    const vectorConfig = resolveVectorModelsConfig(systemConfig);
    const client = new AgentActionPlannerModelClient(model, learningConfig.Client, {
      maxRepairAttempts: learningConfig.MaxRepairAttempts,
    });
    const learningClient = new AgentMemoryLearningModelClient({
      client,
      maxRepairAttempts: learningConfig.MaxRepairAttempts,
    });
    const vectorClient = new AgentVectorModelClient(vectorConfig);
    const writeResolver = new AgentMemoryWriteResolver({
      repository: this.options.repository,
      client,
      vectorClient,
      memoryLearningConfig,
      embeddingModel: vectorConfig.Embedding.Model,
      maxRepairAttempts: learningConfig.MaxRepairAttempts,
    });
    const learningInput = buildMemoryLearningPromptInput(recordedTurn);
    const learned = await learningClient.learnAndValidate(learningInput, {
      supportingSourceRefs: learningInput.supportingSourceRefs,
    });

    if (learned.candidates.length === 0) {
      console.debug("[memory-learning] skipped", {
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
    console.debug("[memory-learning] candidates recorded", {
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
    writeResolver: AgentMemoryWriteResolver;
    vectorClient: AgentVectorModelClient;
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
      await recordMemoryItemEmbeddings(input.vectorClient, this.options.repository, written)
        .catch((error) => {
          console.warn("[memory-learning] absorbed memory item embedding skipped", {
            requestId: input.recordedTurn.episode.requestId,
            message: error instanceof Error ? error.message : String(error),
          });
        });
      console.debug("[memory-learning] candidate absorbed", {
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
      this.options.repository.listPendingMemoryCandidates(recordedTurn.episode.sessionId)
        .map((candidate) => candidate.uri),
    );
    return candidates.filter((candidate) => pendingUris.has(candidate.uri));
  }

  private async promoteReadyCandidates(input: {
    learningClient: AgentMemoryLearningModelClient;
    vectorClient: AgentVectorModelClient;
    writeResolver: AgentMemoryWriteResolver;
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
      const consolidationInput = buildMemoryConsolidationPromptInput(
        input.recordedTurn,
        cluster,
        existingMemories,
      );
      const consolidated = await input.learningClient.consolidateAndValidate(consolidationInput, {
        candidateSources: candidateSourceRefs(cluster),
        existingMemoryUris: consolidationInput.existingMemories.map((memory) => memory.uri),
      });

      if (consolidated.actions.length === 0) {
        continue;
      }

      const resolvedActions: AgentMemoryConsolidationActionRecord[] = [];
      for (const action of consolidated.actions) {
        resolvedActions.push(await input.writeResolver.resolve({
          source: "automatic_learning",
          requestId: input.recordedTurn.episode.requestId,
          standaloneRequest: input.recordedTurn.episode.standaloneRequest,
          proposed: action,
        }));
      }

      const written = this.options.repository.applyMemoryLearning({
        episode: input.recordedTurn.episode,
        actions: resolvedActions,
      });
      await recordMemoryItemEmbeddings(input.vectorClient, this.options.repository, written)
        .catch((error) => {
          console.warn("[memory-learning] memory item embedding skipped", {
            requestId: input.recordedTurn.episode.requestId,
            message: error instanceof Error ? error.message : String(error),
          });
        });
      console.debug("[memory-learning] promoted", {
        requestId: input.recordedTurn.episode.requestId,
        count: written.length,
        operations: resolvedActions.map((action) => action.operation),
        memoryUris: written.map((item) => item.uri),
        candidateUris: cluster.map((item) => item.uri),
      });
    }
  }

}

function candidateToProposedWrite(candidate: AgentMemoryCandidateRecord): AgentMemoryConsolidationActionRecord {
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
