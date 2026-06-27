import {
  resolveModelProviderConfig,
  resolveMemoryLearningConfig,
  resolveToolLearningConfig,
  resolveVectorModelsConfig,
} from "../AgentDefaults.js";
import { AgentActionPlannerModelClient } from "../AgentActionPlannerModelClient.js";
import type {
  AgentMemoryConsolidationPromptInput,
  AgentMemoryLearningPromptInput,
} from "../AgentActionPlannerModelClient.js";
import {
  isRepairablePlanningFailure,
  issueMessages,
  normalizePlanningFailure,
  stringifyIssueValue,
} from "../AgentActionPlannerFailure.js";
import type {
  AgentSystemConfig,
  ResolvedAgentMemoryLearningConfig,
} from "../Types/AgentConfigTypes.js";
import { encodePlannerTimelinePayload } from "../AgentPlannerTimelinePayload.js";
import { AgentVectorModelClient } from "../Vector/AgentVectorModelClient.js";
import { cosineSimilarity } from "../Vector/AgentVectorSimilarity.js";
import {
  parseMemoryConsolidationResult,
  parseMemoryLearningResult,
} from "./AgentMemoryLearningSchema.js";
import {
  memoryCandidateEmbeddingText,
  memoryItemEmbeddingText,
} from "./AgentMemoryText.js";
import {
  AgentMemoryTypes,
  type AgentMemoryCandidateDraft,
  type AgentMemoryCandidateRecord,
  type AgentMemoryConsolidationActionRecord,
  type AgentMemoryItemRecord,
  type AgentMemoryRecordedTurn,
  type AgentMemorySourceKind,
  type AgentMemorySourceRecord,
  type AgentMemorySourceRepository,
} from "./AgentMemorySourceRepository.js";
import { AgentMemoryWriteResolver } from "./AgentMemoryWriteResolver.js";

export interface AgentMemoryLearningRuntimeOptions {
  repository: AgentMemorySourceRepository;
  configSnapshot: () => AgentSystemConfig;
}

const MemoryLearningSourcePolicies = {
  user_message: {
    memoryRole: "support",
    timelineRole: "user",
    timelineKind: "memory_user_message",
  },
  assistant_final: {
    memoryRole: "context",
    timelineRole: "assistant",
    timelineKind: "memory_assistant_context",
  },
  tool_evidence: {
    memoryRole: "support",
    timelineRole: "user",
    timelineKind: "memory_tool_evidence",
  },
  artifact: {
    memoryRole: "support",
    timelineRole: "user",
    timelineKind: "memory_artifact",
  },
} as const satisfies Record<AgentMemorySourceKind, {
  memoryRole: "support" | "context";
  timelineRole: "user" | "assistant";
  timelineKind: string;
}>;

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
    const learned = await this.learnAndValidate(client, learningInput, {
      maxRepairAttempts: learningConfig.MaxRepairAttempts,
      supportingSourceRefs: learningInput.supportingSourceRefs,
    });

    if (learned.candidates.length === 0) {
      console.debug("[memory-learning] skipped", {
        reason: "BAML returned no durable memory candidates",
        requestId: recordedTurn.episode.requestId,
      });
      return;
    }

    const candidates = await withEmbeddings(vectorClient, learned.candidates);
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
      client,
      vectorClient,
      writeResolver,
      memoryLearningConfig,
      recordedTurn,
      candidates: this.pendingRecordedCandidates(recordedTurn, recordedCandidates),
      maxRepairAttempts: learningConfig.MaxRepairAttempts,
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
    client: AgentActionPlannerModelClient;
    vectorClient: AgentVectorModelClient;
    writeResolver: AgentMemoryWriteResolver;
    memoryLearningConfig: ResolvedAgentMemoryLearningConfig;
    recordedTurn: AgentMemoryRecordedTurn;
    candidates: readonly AgentMemoryCandidateRecord[];
    maxRepairAttempts: number;
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
      const consolidated = await this.consolidateAndValidate(input.client, consolidationInput, {
        maxRepairAttempts: input.maxRepairAttempts,
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

  private async learnAndValidate(
    client: AgentActionPlannerModelClient,
    input: AgentMemoryLearningPromptInput,
    options: {
      maxRepairAttempts: number;
      supportingSourceRefs: readonly string[];
    },
  ) {
    let current = await client.learnMemory(input);
    for (let attempt = 0; attempt <= options.maxRepairAttempts; attempt += 1) {
      try {
        return parseMemoryLearningResult(current, {
          supportingSourceRefs: options.supportingSourceRefs,
        });
      } catch (error) {
        if (attempt >= options.maxRepairAttempts) {
          throw error;
        }
        const failure = normalizePlanningFailure(error);
        if (!isRepairablePlanningFailure(failure.error)) {
          throw error;
        }
        current = await client.repairMemoryLearning({
          input,
          invalidLearning: stringifyIssueValue(failure.invalidOutput ?? failure.error),
          issues: issueMessages(failure.error),
        });
      }
    }

    throw new Error("Memory learning validation did not produce a result.");
  }

  private async consolidateAndValidate(
    client: AgentActionPlannerModelClient,
    input: AgentMemoryConsolidationPromptInput,
    options: {
      maxRepairAttempts: number;
      candidateSources: ReadonlyMap<string, readonly string[]>;
      existingMemoryUris: readonly string[];
    },
  ) {
    let current = await client.consolidateMemoryCandidates(input);
    for (let attempt = 0; attempt <= options.maxRepairAttempts; attempt += 1) {
      try {
        return parseMemoryConsolidationResult(current, {
          candidateSources: options.candidateSources,
          existingMemoryUris: options.existingMemoryUris,
        });
      } catch (error) {
        if (attempt >= options.maxRepairAttempts) {
          throw error;
        }
        const failure = normalizePlanningFailure(error);
        if (!isRepairablePlanningFailure(failure.error)) {
          throw error;
        }
        current = await client.repairMemoryConsolidation({
          input,
          invalidConsolidation: stringifyIssueValue(failure.invalidOutput ?? failure.error),
          issues: issueMessages(failure.error),
        });
      }
    }

    throw new Error("Memory consolidation validation did not produce a result.");
  }
}

export function buildMemoryLearningPromptInput(
  recordedTurn: AgentMemoryRecordedTurn,
): AgentMemoryLearningPromptInput {
  const sources = recordedTurn.sources.map(projectSource);
  return {
    memoryTypes: [...AgentMemoryTypes],
    episode: projectEpisode(recordedTurn),
    timeline: [...recordedTurn.sources]
      .sort((left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id))
      .map(projectTimelineSource),
    sourceCatalog: sources,
    supportingSourceRefs: sources
      .filter((source) => source.memoryRole === "support")
      .map((source) => source.sourceRef),
    contextSourceRefs: sources
      .filter((source) => source.memoryRole === "context")
      .map((source) => source.sourceRef),
  };
}

function buildMemoryConsolidationPromptInput(
  recordedTurn: AgentMemoryRecordedTurn,
  candidates: readonly AgentMemoryCandidateRecord[],
  existingMemories: readonly AgentMemoryItemRecord[],
): AgentMemoryConsolidationPromptInput {
  return {
    memoryTypes: [...AgentMemoryTypes],
    episode: projectEpisode(recordedTurn),
    candidates: candidates.map(projectCandidate),
    existingMemories: existingMemories.map(projectExistingMemory),
  };
}

function projectEpisode(recordedTurn: AgentMemoryRecordedTurn): AgentMemoryLearningPromptInput["episode"] {
  return {
    episodeUri: recordedTurn.episode.uri,
    requestId: recordedTurn.episode.requestId,
    standaloneRequest: recordedTurn.episode.standaloneRequest,
    contextMode: recordedTurn.episode.contextMode,
    contextBasis: recordedTurn.episode.contextBasis,
    startedAt: recordedTurn.episode.startedAt,
    completedAt: recordedTurn.episode.completedAt,
    localDate: recordedTurn.episode.localDate,
    localHour: recordedTurn.episode.localHour,
  };
}

function projectSource(source: AgentMemorySourceRecord): AgentMemoryLearningPromptInput["sourceCatalog"][number] {
  const policy = MemoryLearningSourcePolicies[source.sourceKind];
  return {
    sourceRef: source.uri,
    sourceKind: source.sourceKind,
    role: source.role,
    memoryRole: policy.memoryRole,
    evidenceUri: source.evidenceUri,
    artifactUri: source.artifactUri,
    toolName: source.toolName,
    createdAt: source.createdAt,
  };
}

function projectTimelineSource(
  source: AgentMemorySourceRecord,
  index: number,
): AgentMemoryLearningPromptInput["timeline"][number] {
  const policy = MemoryLearningSourcePolicies[source.sourceKind];
  return {
    index,
    role: policy.timelineRole,
    kind: policy.timelineKind,
    content: source.summary ?? source.textContent ?? "",
    payloadJson: encodePlannerTimelinePayload({
      sourceRef: source.uri,
      sourceKind: source.sourceKind,
      sourceRole: source.role,
      memoryRole: policy.memoryRole,
      content: source.textContent ?? undefined,
      summary: source.summary ?? undefined,
      evidenceUri: source.evidenceUri || undefined,
      artifactUri: source.artifactUri || undefined,
      toolName: source.toolName || undefined,
      metadata: source.metadata,
      createdAt: source.createdAt,
    }),
    evidenceUris: source.evidenceUri ? [source.evidenceUri] : [],
    artifactUris: source.artifactUri ? [source.artifactUri] : [],
  };
}

function projectCandidate(
  candidate: AgentMemoryCandidateRecord,
): AgentMemoryConsolidationPromptInput["candidates"][number] {
  return {
    uri: candidate.uri,
    type: candidate.type,
    subject: candidate.subject,
    claim: candidate.claim,
    howToApply: candidate.howToApply,
    tags: candidate.tags,
    triggers: candidate.triggers,
    sourceRefs: candidate.sourceRefs,
    reason: candidate.reason,
    confidence: candidate.confidence,
    createdAt: candidate.createdAt,
  };
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

function projectExistingMemory(
  memory: AgentMemoryItemRecord,
): AgentMemoryConsolidationPromptInput["existingMemories"][number] {
  return {
    uri: memory.uri,
    type: memory.type,
    subject: memory.subject,
    claim: memory.claim,
    howToApply: memory.howToApply,
    tags: memory.tags,
    triggers: memory.triggers,
    confidence: memory.confidence,
    updatedAt: memory.updatedAt,
  };
}

async function withEmbeddings(
  vectorClient: AgentVectorModelClient,
  candidates: readonly AgentMemoryCandidateDraft[],
): Promise<AgentMemoryCandidateDraft[]> {
  const result = await vectorClient.embed({
    input: candidates.map(memoryCandidateEmbeddingText),
  });
  return candidates.map((candidate, index) => ({
    ...candidate,
    embedding: result.vectors[index],
  }));
}

async function recordMemoryItemEmbeddings(
  vectorClient: AgentVectorModelClient,
  repository: AgentMemorySourceRepository,
  items: readonly AgentMemoryItemRecord[],
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const result = await vectorClient.embed({
    input: items.map(memoryItemEmbeddingText),
  });
  repository.upsertMemoryItemVectors(items.flatMap((item, index) => {
    const embedding = result.vectors[index];
    return embedding ? [{
      memoryUri: item.uri,
      model: result.model,
      embedding,
      updatedAt: item.updatedAt,
    }] : [];
  }));
}

async function rankSimilarPendingCandidates(
  vectorClient: AgentVectorModelClient,
  config: ResolvedAgentMemoryLearningConfig,
  target: AgentMemoryCandidateRecord,
  pending: readonly AgentMemoryCandidateRecord[],
): Promise<AgentMemoryCandidateRecord[]> {
  const embeddingRanked = pending
    .map((candidate) => ({
      candidate,
      score: memoryCandidateSimilarity(target, candidate),
    }))
    .filter((item) => item.score >= config.Promotion.MinSimilarity)
    .sort((left, right) =>
      right.score - left.score
      || left.candidate.createdAtMs - right.candidate.createdAtMs
      || left.candidate.id.localeCompare(right.candidate.id))
    .slice(0, config.Promotion.MaxClusterSize)
    .map((item) => item.candidate);

  const reranked = await vectorClient.rerank({
    query: memoryCandidateEmbeddingText(target),
    documents: embeddingRanked.map((candidate) => ({
      id: candidate.uri,
      text: memoryCandidateEmbeddingText(candidate),
    })),
    topK: config.Promotion.MaxClusterSize,
  });

  if (reranked.results.length === 0) {
    return embeddingRanked;
  }

  const byUri = new Map(embeddingRanked.map((candidate) => [candidate.uri, candidate]));
  return reranked.results
    .map((item) => byUri.get(item.id))
    .filter((candidate): candidate is AgentMemoryCandidateRecord => Boolean(candidate));
}

function memoryCandidateSimilarity(
  left: AgentMemoryCandidateRecord,
  right: AgentMemoryCandidateRecord,
): number {
  if (left.uri === right.uri) {
    return 1;
  }
  if (left.embedding && right.embedding) {
    return cosineSimilarity(left.embedding, right.embedding);
  }
  return left.subject === right.subject && left.claim === right.claim ? 1 : 0;
}

function candidateSourceRefs(
  candidates: readonly AgentMemoryCandidateRecord[],
): ReadonlyMap<string, readonly string[]> {
  return new Map(candidates.map((candidate) => [candidate.uri, candidate.sourceRefs]));
}
