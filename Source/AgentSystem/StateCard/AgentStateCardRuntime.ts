import type { ResolvedAgentModelProviderConfig, ResolvedAgentStateCardConfig } from "../Types/AgentConfigTypes.js";
import type { AgentLanguageModelCacheOptions } from "../ModelEndpoints/AgentLanguageModel.js";
import { AgentStructuredModelClient } from "../ModelEndpoints/AgentStructuredModelClient.js";
import { resolvePlannerProvider } from "../ActionPlanner/AgentActionPlannerProviderResolver.js";
import { AgentCancellationError, throwAbortReason } from "../Core/AgentCancellation.js";
import { errorMessage } from "../Core/AgentErrors.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import {
  createAgentPiLogicalCacheScope,
  createAgentPiPromptCacheOptions,
  projectAgentPiPromptCacheModel,
} from "../Pi/AgentPiPromptCache.js";
import type { AgentBackgroundLearningRequestLedger } from "../Memory/AgentBackgroundLearningRequestLedger.js";
import { buildAgentStateCard } from "./AgentStateCardBuilder.js";
import {
  AgentStateCardRewriteSchema,
  AgentStateCardRewriteSystemPrompt,
  buildAgentStateCardRewriteInput,
} from "./AgentStateCardPrompt.js";
import {
  AgentStateCardHistoryLayers,
  type AgentStateCard,
  type AgentStateCardHistoryTurn,
  type AgentStateCardToolReference,
} from "./AgentStateCardTypes.js";
import { isAgentHumanUserMessage, type AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";

export interface AgentStateCardRuntimeRequest {
  currentRequest: string;
  requestId?: string;
  /** Durable user-message identity for this execution; differs on a retry. */
  conversationRequestId?: string;
  turnIndex?: number;
  sessionId?: string;
  logicalCacheScope?: string;
  activeSkills?: readonly string[];
  signal?: AbortSignal;
  interaction?: AgentInteractionContext;
}
export interface AgentStateCardTurnRecord {
  sessionId?: string;
  request: string;
  assistant?: string;
  tools?: readonly AgentStateCardToolReference[];
  artifacts?: readonly string[];
}
export interface AgentStateCardRuntimeOptions {
  maxRepairAttempts: number;
  historyTurns: number;
  assistantPreviewTokens: number;
  readHistory?: (sessionId: string, excludedRequestId?: string) => readonly AgentStateCardHistoryTurn[];
  readTasks?: (
    sessionId: string,
    interaction?: AgentInteractionContext,
  ) => readonly { readonly requestId: string; readonly request: string }[];
  learningRequests?: AgentBackgroundLearningRequestLedger;
  /** Derived-context failures stay in the background diagnostics stream. */
  logger?: AgentLogger;
}

/** Structural projection is local; model rewriting is best-effort derived context. */
export class AgentStateCardRuntime {
  private readonly client: AgentStructuredModelClient;
  private readonly provider: ResolvedAgentModelProviderConfig;
  private currentCard?: { key: string; card: AgentStateCard };
  private readonly recentTurns = new Map<string, AgentStateCardHistoryTurn[]>();

  constructor(
    _modelProvider: ResolvedAgentModelProviderConfig,
    private readonly config: ResolvedAgentStateCardConfig,
    private readonly options: AgentStateCardRuntimeOptions,
  ) {
    this.provider = resolvePlannerProvider(config.Client);
    this.client = new AgentStructuredModelClient(this.provider, "StateCard", {
      maxRepairAttempts: options.maxRepairAttempts,
    });
  }
  get enabled(): boolean {
    return this.config.Enabled;
  }

  project(request: AgentStateCardRuntimeRequest): AgentStateCard {
    return buildAgentStateCard({
      currentRequest: request.currentRequest,
      history: this.history(request.sessionId, request.conversationRequestId ?? request.requestId),
      ...(request.turnIndex === undefined ? {} : { turnIndex: request.turnIndex }),
      ...(request.activeSkills ? { activeSkills: request.activeSkills } : {}),
    });
  }
  async resolve(request: AgentStateCardRuntimeRequest): Promise<AgentStateCard> {
    const history = this.history(request.sessionId, request.conversationRequestId ?? request.requestId);
    const tasks = request.sessionId ? (this.options.readTasks?.(request.sessionId, request.interaction) ?? []) : [];
    const structural = this.project(request);
    if (!this.config.Enabled || !request.currentRequest.trim() || (history.length === 0 && tasks.length === 0))
      return structural;
    const key = this.cacheKey(request);
    if (this.currentCard?.key === key) return this.currentCard.card;
    const rewriteInput = buildAgentStateCardRewriteInput({
      currentRequest: request.currentRequest,
      history,
      tasks,
      activeSkills: request.activeSkills,
      historyBudgetCharacters: this.config.HistoryBudgetCharacters,
      assistantPreviewTokens: this.options.assistantPreviewTokens,
      model: this.provider.Model,
    });
    const execute = () =>
      this.client.execute({
        contract: {
          name: "RewriteStateCard",
          description: "Resolve the current request using grounded conversational context.",
          schema: AgentStateCardRewriteSchema.superRefine((value, context) => {
            if (value.resumeRequestId && !rewriteInput.taskRequestIds.includes(value.resumeRequestId))
              context.addIssue({ code: "custom", message: "Resume only a supplied durable task request." });
          }),
          bamlFunction: "RewriteStateCard",
        },
        systemPrompt: AgentStateCardRewriteSystemPrompt,
        userPrompt: rewriteInput.userPrompt,
        requestId: request.requestId ?? crypto.randomUUID(),
        signal: request.signal,
        cache: this.cacheOptions(request),
      });
    let rewrite: import("zod").z.infer<typeof AgentStateCardRewriteSchema>;
    try {
      rewrite = this.options.learningRequests
        ? await this.options.learningRequests.run(
            {
              operationKey: `state_card:${key}`,
              board: "state_card",
              stage: "rewrite",
              entityUri: request.sessionId,
              attempt: 1,
              providerId: this.provider.Id,
              model: this.provider.Model,
            },
            execute,
            (result) => ({ outputCharacters: result.standaloneRequest.length }),
          )
        : await execute();
    } catch (error) {
      if (error instanceof AgentCancellationError) throw error;
      throwAbortReason(request.signal);
      this.options.logger?.warn("memory.state_card.rewrite_skipped", {
        requestId: request.requestId,
        sessionId: request.sessionId,
        providerId: this.provider.Id,
        model: this.provider.Model,
        message: errorMessage(error),
      });
      this.currentCard = { key, card: structural };
      return structural;
    }
    const { resumeRequestId, ...fields } = rewrite;
    const resolved = { ...structural, ...fields, ...(resumeRequestId ? { resumeRequestId } : {}) };
    this.currentCard = { key, card: resolved };
    return resolved;
  }
  recordTurn(record: AgentStateCardTurnRecord): void {
    const key = record.sessionId?.trim();
    if (!key || this.options.readHistory) return;
    const turns = this.recentTurns.get(key) ?? [];
    this.recentTurns.set(
      key,
      [
        ...turns,
        {
          request: record.request,
          assistant: record.assistant,
          layer: AgentStateCardHistoryLayers.Fine,
          tools: record.tools ?? [],
          artifacts: record.artifacts ?? [],
        },
      ].slice(-this.options.historyTurns),
    );
  }
  private history(sessionId?: string, excludedRequestId?: string): readonly AgentStateCardHistoryTurn[] {
    const key = sessionId?.trim();
    if (!key) return [];
    return (
      this.options.readHistory ? this.options.readHistory(key, excludedRequestId) : (this.recentTurns.get(key) ?? [])
    ).slice(-this.options.historyTurns);
  }
  private cacheOptions(request: AgentStateCardRuntimeRequest): AgentLanguageModelCacheOptions | undefined {
    if (!request.sessionId?.trim()) return undefined;
    return createAgentPiPromptCacheOptions({
      phase: "state-card",
      sessionId: request.sessionId,
      logicalCacheScope:
        request.logicalCacheScope ??
        createAgentPiLogicalCacheScope({ sessionId: request.sessionId, family: "state-card" }),
      model: projectAgentPiPromptCacheModel(this.provider),
    });
  }
  private cacheKey(request: AgentStateCardRuntimeRequest): string {
    return [
      request.sessionId ?? "",
      request.requestId ?? "",
      request.turnIndex === undefined ? "" : String(request.turnIndex),
      request.currentRequest.trim(),
    ].join("\u0000");
  }
}

/**
 * Projects the durable conversation into the bounded state-card history. A
 * cancelled run keeps its user entry in the session store, while its missing
 * assistant/tool side stays missing and is never treated as learned knowledge.
 */
export function projectAgentStateCardConversationHistory(
  conversation: readonly AgentConversationEntry[],
  completedHistory: readonly AgentStateCardHistoryTurn[] = [],
  excludedRequestId?: string,
): AgentStateCardHistoryTurn[] {
  const completedByRequestId = new Map(
    completedHistory.filter((turn) => turn.requestId !== undefined).map((turn) => [turn.requestId!, turn]),
  );
  const turns = new Map<string, AgentStateCardHistoryTurn>();
  for (const entry of conversation) {
    if (entry.requestId === excludedRequestId) continue;
    if (!isAgentHumanUserMessage(entry)) continue;
    const completed = completedByRequestId.get(entry.requestId);
    turns.set(entry.requestId, {
      requestId: entry.requestId,
      request: entry.content,
      layer: AgentStateCardHistoryLayers.Fine,
      ...(completed?.assistant ? { assistant: completed.assistant } : {}),
      tools: completed?.tools ?? [],
      artifacts: completed?.artifacts ?? [],
    });
  }
  return [...turns.values()];
}
