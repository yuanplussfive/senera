import type {
  AgentMemoryWriteResolutionPromptInput,
} from "../AgentActionPlannerModelClient.js";
import { AgentActionPlannerModelClient } from "../AgentActionPlannerModelClient.js";
import {
  isRepairablePlanningFailure,
  issueMessages,
  normalizePlanningFailure,
  stringifyIssueValue,
} from "../AgentActionPlannerFailure.js";
import type { ResolvedAgentMemoryLearningConfig } from "../Types/AgentConfigTypes.js";
import { AgentVectorModelClient } from "../Vector/AgentVectorModelClient.js";
import {
  parseMemoryWriteResolutionResult,
} from "./AgentMemoryLearningSchema.js";
import {
  rankSimilarMemoryItems,
} from "./AgentMemoryVectorIndex.js";
import {
  AgentMemoryTypes,
  type AgentMemoryConsolidationActionRecord,
  type AgentMemoryItemRecord,
  type AgentMemorySourceRepository,
} from "./AgentMemorySourceRepository.js";

export const AgentMemoryWriteOperations = [
  "create",
  "reinforce",
  "update",
  "supersede",
  "reject",
] as const;

export interface AgentMemoryWriteResolverOptions {
  repository: AgentMemorySourceRepository;
  client: AgentActionPlannerModelClient;
  vectorClient: AgentVectorModelClient;
  memoryLearningConfig: ResolvedAgentMemoryLearningConfig;
  embeddingModel: string;
  maxRepairAttempts: number;
}

export interface AgentMemoryWriteResolutionRequest {
  source: "automatic_learning" | "direct_tool";
  requestId: string;
  standaloneRequest: string;
  proposed: AgentMemoryConsolidationActionRecord;
  signal?: AbortSignal;
}

export class AgentMemoryWriteResolver {
  constructor(private readonly options: AgentMemoryWriteResolverOptions) {}

  async resolve(input: AgentMemoryWriteResolutionRequest): Promise<AgentMemoryConsolidationActionRecord> {
    const similarMemories = await this.similarMemories(input);
    if (similarMemories.length === 0 && input.proposed.operation === "create") {
      return input.proposed;
    }

    const promptInput = buildMemoryWriteResolutionPromptInput(input, similarMemories);
    let current = await this.options.client.resolveMemoryWrite(promptInput, {
      signal: input.signal,
    });

    for (let attempt = 0; attempt <= this.options.maxRepairAttempts; attempt += 1) {
      try {
        return parseMemoryWriteResolutionResult(current, {
          allowedOperations: AgentMemoryWriteOperations,
          memoryTypes: AgentMemoryTypes,
          sourceRefs: input.proposed.sourceRefs,
          candidateUris: input.proposed.candidateUris,
          similarMemoryUris: similarMemories.map((item) => item.uri),
        }).decision;
      } catch (error) {
        if (attempt >= this.options.maxRepairAttempts) {
          throw error;
        }
        const failure = normalizePlanningFailure(error);
        if (!isRepairablePlanningFailure(failure.error)) {
          throw error;
        }
        current = await this.options.client.repairMemoryWriteResolution({
          input: promptInput,
          invalidResolution: stringifyIssueValue(failure.invalidOutput ?? failure.error),
          issues: issueMessages(failure.error),
        }, {
          signal: input.signal,
        });
      }
    }

    throw new Error("Memory write resolution did not produce a result.");
  }

  private async similarMemories(
    input: AgentMemoryWriteResolutionRequest,
  ): Promise<Array<AgentMemoryItemRecord & { similarity: number }>> {
    const active = this.options.repository.listActiveMemoryItems()
      .filter((item) => item.type === input.proposed.type);
    const ranked = await rankSimilarMemoryItems(
      this.options.vectorClient,
      this.options.repository,
      {
        text: proposedMemoryText(input.proposed),
        items: active,
        model: this.options.embeddingModel,
        limit: this.options.memoryLearningConfig.Promotion.MaxClusterSize,
        minSimilarity: this.options.memoryLearningConfig.Promotion.MinSimilarity,
        signal: input.signal,
      },
    );

    const byUri = new Map(ranked.map((entry) => [entry.item.uri, {
      ...entry.item,
      similarity: entry.score,
    }]));
    const target = input.proposed.targetMemoryUri
      ? active.find((item) => item.uri === input.proposed.targetMemoryUri)
      : undefined;
    if (target && !byUri.has(target.uri)) {
      byUri.set(target.uri, {
        ...target,
        similarity: 1,
      });
    }
    return [...byUri.values()]
      .sort((left, right) => right.similarity - left.similarity || left.uri.localeCompare(right.uri));
  }
}

function buildMemoryWriteResolutionPromptInput(
  input: AgentMemoryWriteResolutionRequest,
  similarMemories: ReadonlyArray<AgentMemoryItemRecord & { similarity: number }>,
): AgentMemoryWriteResolutionPromptInput {
  return {
    memoryTypes: [...AgentMemoryTypes],
    allowedOperations: [...AgentMemoryWriteOperations],
    request: {
      source: input.source,
      requestId: input.requestId,
      standaloneRequest: input.standaloneRequest,
    },
    proposed: {
      operation: input.proposed.operation,
      type: input.proposed.type,
      subject: input.proposed.subject,
      claim: input.proposed.claim,
      howToApply: input.proposed.howToApply,
      tags: input.proposed.tags,
      triggers: input.proposed.triggers,
      sourceRefs: input.proposed.sourceRefs,
      candidateUris: input.proposed.candidateUris,
      targetMemoryUri: input.proposed.targetMemoryUri,
      reason: input.proposed.reason,
      confidence: input.proposed.confidence,
    },
    similarMemories: similarMemories.map((memory) => ({
      uri: memory.uri,
      type: memory.type,
      subject: memory.subject,
      claim: memory.claim,
      howToApply: memory.howToApply,
      tags: memory.tags,
      triggers: memory.triggers,
      confidence: memory.confidence,
      updatedAt: memory.updatedAt,
      similarity: memory.similarity,
    })),
  };
}

function proposedMemoryText(action: AgentMemoryConsolidationActionRecord): string {
  return [
    action.type,
    action.subject,
    action.claim,
    action.howToApply,
    action.tags.join(" "),
    action.triggers.join(" "),
  ].join("\n");
}
