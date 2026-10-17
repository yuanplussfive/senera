import type { ResolvedAgentModelProviderConfig, ResolvedAgentStateCardConfig } from "../Types/AgentConfigTypes.js";
import type { AgentLanguageModelCacheOptions } from "../ModelEndpoints/AgentLanguageModel.js";
import { AgentStructuredModelClient } from "../ModelEndpoints/AgentStructuredModelClient.js";
import { resolvePlannerProvider } from "../ActionPlanner/AgentActionPlannerProviderResolver.js";
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

export interface AgentStateCardRuntimeRequest {
  currentRequest: string;
  requestId?: string;
  turnIndex?: number;
  sessionId?: string;
  logicalCacheScope?: string;
  activeSkills?: readonly string[];
  signal?: AbortSignal;
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
  readHistory?: (sessionId: string) => readonly AgentStateCardHistoryTurn[];
  learningRequests?: AgentBackgroundLearningRequestLedger;
}

/** Structural projection is local; follow-up resolution uses the configured structured model synchronously. */
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
      history: this.history(request.sessionId),
      ...(request.turnIndex === undefined ? {} : { turnIndex: request.turnIndex }),
      ...(request.activeSkills ? { activeSkills: request.activeSkills } : {}),
    });
  }
  async resolve(request: AgentStateCardRuntimeRequest): Promise<AgentStateCard> {
    const history = this.history(request.sessionId);
    const structural = this.project(request);
    if (!this.config.Enabled || !request.currentRequest.trim() || history.length === 0) return structural;
    const key = this.cacheKey(request);
    if (this.currentCard?.key === key) return this.currentCard.card;
    const execute = () =>
      this.client.execute({
        contract: {
          name: "RewriteStateCard",
          description: "Resolve the current request using grounded conversational context.",
          schema: AgentStateCardRewriteSchema,
          bamlFunction: "RewriteStateCard",
        },
        systemPrompt: AgentStateCardRewriteSystemPrompt,
        userPrompt: buildAgentStateCardRewriteInput({
          currentRequest: request.currentRequest,
          history,
          activeSkills: request.activeSkills,
          historyBudgetCharacters: this.config.HistoryBudgetCharacters,
          assistantPreviewTokens: this.options.assistantPreviewTokens,
          model: this.provider.Model,
        }),
        requestId: request.requestId ?? crypto.randomUUID(),
        signal: request.signal,
        cache: this.cacheOptions(request),
      });
    const rewrite = this.options.learningRequests
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
    const resolved = { ...structural, ...rewrite };
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
  private history(sessionId?: string): readonly AgentStateCardHistoryTurn[] {
    const key = sessionId?.trim();
    if (!key) return [];
    return (this.options.readHistory ? this.options.readHistory(key) : (this.recentTurns.get(key) ?? [])).slice(
      -this.options.historyTurns,
    );
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
