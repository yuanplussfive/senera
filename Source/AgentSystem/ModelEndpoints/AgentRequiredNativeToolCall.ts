import type { AssistantMessage, Context, Tool } from "@earendil-works/pi-ai";
import { AgentInvalidModelToolArgumentsError, AgentRequiredModelToolCallError } from "./AgentModelFailureMapper.js";
import { projectAgentNativeRequiredToolChoice } from "./AgentModelEndpointContract.js";
import { createAgentPiConfiguredProvider } from "./AgentPiConfiguredProvider.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentLanguageModelCacheOptions } from "./AgentLanguageModel.js";
import { AgentModelUsageResolver, recordActiveAgentModelUsage, type AgentModelUsageSink } from "./AgentModelUsage.js";
import { projectAgentPiAssistantUsage } from "./AgentPiModelUsage.js";

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
  }): Promise<unknown> {
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
    (this.usageSink ?? recordActiveAgentModelUsage)({ stage: `${this.runtimeLabel}:${input.tool.name}`, usage });
    return argumentsValue;
  }
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
