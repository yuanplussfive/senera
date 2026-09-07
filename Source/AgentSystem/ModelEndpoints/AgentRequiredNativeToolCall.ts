import type { AssistantMessage, Context, Tool } from "@earendil-works/pi-ai";
import { AgentInvalidModelToolArgumentsError, AgentRequiredModelToolCallError } from "./AgentModelFailureMapper.js";
import { projectAgentNativeRequiredToolChoice } from "./AgentModelEndpointContract.js";
import { createAgentPiConfiguredProvider } from "./AgentPiConfiguredProvider.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentLanguageModelCacheOptions } from "./AgentLanguageModel.js";
import { AgentModelUsageResolver, recordActiveAgentModelUsage, type AgentModelUsageSink } from "./AgentModelUsage.js";
import { projectAgentPiAssistantUsage } from "./AgentPiModelUsage.js";
import type { AgentModelTimingRecord, AgentModelTimingSink } from "./AgentModelTiming.js";
import { errorMessage } from "../Core/AgentErrors.js";

/** Executes one isolated required tool call through Pi's configured provider adapter. */
export class AgentRequiredNativeToolCall {
  private readonly model;
  private readonly provider;
  private readonly usageResolver: AgentModelUsageResolver;

  constructor(
    private readonly configuration: ResolvedAgentModelProviderConfig,
    private readonly runtimeLabel: string,
    private readonly usageSink?: AgentModelUsageSink,
  ) {
    ({ model: this.model, provider: this.provider } = createAgentPiConfiguredProvider(configuration, runtimeLabel));
    this.usageResolver = new AgentModelUsageResolver(configuration.Model);
  }

  async execute(input: {
    readonly tool: Tool;
    readonly systemPrompt: string;
    readonly userPrompt: string;
    readonly signal?: AbortSignal;
    readonly cache?: AgentLanguageModelCacheOptions;
    readonly requestId?: string;
    readonly timingSink?: AgentModelTimingSink;
  }): Promise<unknown> {
    const startedAt = performance.now();
    const requestId = input.requestId ?? `${this.runtimeLabel}:${input.tool.name}:${Date.now()}`;
    const stage = `${this.runtimeLabel}:${input.tool.name}`;
    const requestCharacters = input.systemPrompt.length + input.userPrompt.length;
    try {
      const message = await this.provider
        .stream(
          this.model,
          {
            systemPrompt: input.systemPrompt,
            messages: [{ role: "user", content: input.userPrompt, timestamp: Date.now() }],
            tools: [input.tool],
          } satisfies Context,
          {
            signal: input.signal,
            apiKey: this.configuration.ApiKey || undefined,
            temperature: this.configuration.Temperature,
            timeoutMs: this.configuration.TimeoutMs,
            maxRetries: this.configuration.MaxNetworkRetries,
            maxRetryDelayMs: this.configuration.RetryAfterMaxDelayMs,
            toolChoice: projectAgentNativeRequiredToolChoice(this.model.api, input.tool.name),
            ...(input.cache ? { sessionId: input.cache.scope, cacheRetention: input.cache.retention } : {}),
          } as never,
        )
        .result();
      const argumentsValue = extractRequiredToolArguments(message, input.tool.name);
      const usage = this.usageResolver.resolve(
        {
          systemPrompt: input.systemPrompt,
          messages: [{ role: "user", content: input.userPrompt }],
        },
        JSON.stringify(argumentsValue),
        projectAgentPiAssistantUsage(message),
      );
      (this.usageSink ?? recordActiveAgentModelUsage)({ stage, usage });
      await recordTiming(input.timingSink, this.configuration, {
        stage,
        requestId,
        status: "completed",
        durationMs: elapsedMilliseconds(startedAt),
        requestCharacters,
        responseCharacters: JSON.stringify(argumentsValue).length,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
      });
      return argumentsValue;
    } catch (error) {
      await recordTiming(input.timingSink, this.configuration, {
        stage,
        requestId,
        status: "failed",
        durationMs: elapsedMilliseconds(startedAt),
        requestCharacters,
        responseCharacters: 0,
        error: errorMessage(error),
      });
      throw error;
    }
  }
}

async function recordTiming(
  sink: AgentModelTimingSink | undefined,
  configuration: ResolvedAgentModelProviderConfig,
  record: Omit<AgentModelTimingRecord, "providerId" | "model">,
): Promise<void> {
  try {
    await sink?.({
      ...record,
      providerId: configuration.Id,
      model: configuration.Model,
    });
  } catch {
    // Timing is observational and must never change a required tool result.
  }
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function extractRequiredToolArguments(message: AssistantMessage, toolName: string): Record<string, unknown> {
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    throw new Error(message.errorMessage ?? `Required ${toolName} request did not complete.`);
  }
  const calls = message.content.filter(
    (block): block is Extract<AssistantMessage["content"][number], { type: "toolCall" }> => block.type === "toolCall",
  );
  if (calls.length !== 1 || calls[0]?.name !== toolName) {
    throw new AgentRequiredModelToolCallError(
      toolName,
      calls.map((call) => call.name),
    );
  }
  const argumentsValue = calls[0].arguments;
  if (!argumentsValue || typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) {
    throw new AgentInvalidModelToolArgumentsError(toolName);
  }
  return argumentsValue;
}
