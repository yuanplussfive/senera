import {
  EmptyAgentContinuityMemoryPromptContext,
  type AgentContinuityMemoryPromptContext,
} from "./AgentContinuityMemoryTypes.js";
import { AgentContinuitySqliteStore } from "./AgentContinuitySqliteStore.js";
import type { AgentMemoryDeletionImpact } from "../Memory/AgentMemorySourceRepository.js";
import { throwAbortReason } from "../Core/AgentCancellation.js";
import type { AgentContinuityLearningRecallConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";
import {
  applyAgentContinuityPromptBudget,
  type AgentContinuityHistoricalTokenBudget,
} from "./AgentContinuityPromptBudget.js";
import type { AgentContinuityMemOSRuntime, AgentContinuityMemOSSearchResult } from "./AgentContinuityMemOSRuntime.js";
import {
  AgentMemOSTags,
  agentMemOSRevision,
  projectAgentMemOSOccurredAt,
  projectAgentMemOSPeriod,
  AgentMemOSSummarySchema,
} from "./AgentMemOSSemanticTypes.js";
import { agentMemOSReference } from "./AgentMemOSReference.js";

interface RecallInput {
  readonly userInput: string;
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly signal?: AbortSignal;
  readonly historicalTokenBudget?: AgentContinuityHistoricalTokenBudget;
  readonly excludedMemoryKeys?: ReadonlySet<string>;
  readonly deliveryEpoch?: number;
}

export interface AgentContinuityMemoryServiceOptions {
  readonly store: AgentContinuitySqliteStore;
  readonly recallConfig: () => AgentContinuityLearningRecallConfig;
  readonly memos: Pick<AgentContinuityMemOSRuntime, "search" | "searchRecent">;
}

/** Builds prompt memory from the single MemOS authority. */
export class AgentContinuityMemoryService {
  private readonly deliveryEpochs = new Map<string, number>();
  constructor(private readonly options: AgentContinuityMemoryServiceOptions) {}

  async promptContext(input: RecallInput): Promise<AgentContinuityMemoryPromptContext> {
    throwAbortReason(input.signal);
    const recall = this.options.recallConfig();
    const deliveryEpoch = input.deliveryEpoch ?? (input.sessionId ? this.deliveryEpoch(input.sessionId) : undefined);
    if (!input.historicalTokenBudget || input.historicalTokenBudget.maxTokens <= 0)
      return {
        ...EmptyAgentContinuityMemoryPromptContext,
        enabled: true,
        ...(input.userInput.trim() ? { query: input.userInput.trim() } : {}),
        ...(deliveryEpoch === undefined ? {} : { deliveryEpoch }),
      };
    const results = input.userInput.trim()
      ? await this.options.memos.search(input.userInput, { excludedKeys: input.excludedMemoryKeys })
      : await this.options.memos.searchRecent({ excludedKeys: input.excludedMemoryKeys });
    throwAbortReason(input.signal);
    const budgeted = applyAgentContinuityPromptBudget(
      {
        digests: results.flatMap(projectMemOSPeriodDigest),
        events: results.flatMap(projectMemOSEvent),
        historicalTokenBudget: input.historicalTokenBudget,
      },
      recall.PromptBudget,
    );
    return {
      enabled: true,
      ...(input.userInput.trim() ? { query: input.userInput.trim() } : {}),
      ...(deliveryEpoch === undefined ? {} : { deliveryEpoch }),
      periodDigests: budgeted.digests,
      eventCandidates: budgeted.events,
      selection: budgeted.selection,
    };
  }
  async liveContext(
    input: Omit<RecallInput, "userInput"> & { readonly userInput?: string } = {},
  ): Promise<AgentContinuityMemoryPromptContext> {
    let memory: AgentContinuityMemoryPromptContext;
    do {
      const deliveryEpoch = input.sessionId ? this.deliveryEpoch(input.sessionId) : undefined;
      const delivered = new Set(
        input.sessionId ? this.options.store.listMemoryDeliveryKeys(input.sessionId, "active") : [],
      );
      memory = await this.promptContext({
        ...input,
        userInput: input.userInput ?? "",
        excludedMemoryKeys: delivered,
        deliveryEpoch,
      });
    } while (input.sessionId && memory.deliveryEpoch !== this.deliveryEpoch(input.sessionId));
    return memory;
  }
  commitLiveContextDelivery(input: {
    readonly sessionId?: string;
    readonly memory: AgentContinuityMemoryPromptContext;
    readonly deliveredAt?: string;
  }): number {
    if (!input.sessionId) return 0;
    if (input.memory.deliveryEpoch !== undefined && input.memory.deliveryEpoch !== this.deliveryEpoch(input.sessionId))
      return 0;
    const entries = [...input.memory.eventCandidates, ...input.memory.periodDigests];
    const keys = entries.flatMap((entry) => entry.deliveryKeys ?? [entry.uri, entry.uri + "@" + entry.revision]);
    this.options.store.recordMemoryDelivery(input.sessionId, keys, input.deliveredAt ?? new Date().toISOString());
    return entries.length;
  }
  invalidateSessionContext(sessionId: string): number {
    this.deliveryEpochs.set(sessionId, this.deliveryEpoch(sessionId) + 1);
    return this.options.store.clearMemoryDelivery(sessionId);
  }
  deleteSession(sessionId: string): void {
    this.deliveryEpochs.set(sessionId, this.deliveryEpoch(sessionId) + 1);
  }
  deleteSources(impact: AgentMemoryDeletionImpact): void {
    if (impact.sessionId) this.deleteSession(impact.sessionId);
  }
  private deliveryEpoch(sessionId: string): number {
    return this.deliveryEpochs.get(sessionId) ?? 0;
  }
}

function projectMemOSEvent(
  result: AgentContinuityMemOSSearchResult,
): AgentContinuityMemoryPromptContext["eventCandidates"][number][] {
  const node = result.memory.node;
  if (!node.tags.includes(AgentMemOSTags.knowledge)) return [];
  const summary = AgentMemOSSummarySchema.parse(node.summary);
  return [
    {
      id: node.id,
      uri: agentMemOSReference(node.id),
      revision: agentMemOSRevision(node),
      type: node.type,
      summary,
      occurredAt: projectAgentMemOSOccurredAt(node),
      score: result.memory.score,
      matchedBy: ["memos", ...Object.keys(result.memory.scores ?? {})],
      ...(result.memory.scores ? { scores: { ...result.memory.scores } } : {}),
      deliveryKeys: result.deliveryKeys,
    },
  ];
}

function projectMemOSPeriodDigest(
  result: AgentContinuityMemOSSearchResult,
): AgentContinuityMemoryPromptContext["periodDigests"][number][] {
  const node = result.memory.node;
  const period = projectAgentMemOSPeriod(node.tags);
  if (!period) return [];
  const summary = AgentMemOSSummarySchema.parse(node.summary);
  return [
    {
      id: node.id,
      uri: agentMemOSReference(node.id),
      revision: agentMemOSRevision(node),
      granularity: period.granularity,
      periodStart: period.start,
      periodEnd: period.end,
      summary,
      score: result.memory.score,
      matchedBy: ["memos", ...Object.keys(result.memory.scores ?? {})],
      ...(result.memory.scores ? { scores: { ...result.memory.scores } } : {}),
      deliveryKeys: result.deliveryKeys,
    },
  ];
}
