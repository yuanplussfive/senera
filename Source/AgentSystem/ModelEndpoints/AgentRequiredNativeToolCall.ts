import type { AssistantMessage, Context, Tool } from "@earendil-works/pi-ai";
import { AgentInvalidModelToolArgumentsError } from "./AgentModelFailureMapper.js";
import { projectAgentNativeRequiredToolChoice } from "./AgentModelEndpointContract.js";
import { createAgentPiConfiguredProvider } from "./AgentPiConfiguredProvider.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentLanguageModelCacheOptions } from "./AgentLanguageModel.js";
import { ensureAgentModelCacheStablePrefix } from "./AgentModelCacheScope.js";
import { AgentModelUsageResolver, recordActiveAgentModelUsage, type AgentModelUsageSink } from "./AgentModelUsage.js";
import { projectAgentPiAssistantUsage } from "./AgentPiModelUsage.js";
import type { AgentModelTimingRecord, AgentModelTimingSink } from "./AgentModelTiming.js";
import { errorMessage } from "../Core/AgentErrors.js";
import {
  createAgentPromptWireCapture,
  projectAgentPromptCacheRetention,
  projectAgentStablePrefixBytes,
  projectAgentStablePrefixRevision,
  resolveAgentPromptCacheObservation,
  resolveAgentPromptCacheStrategy,
  type AgentPromptWireSnapshot,
} from "./AgentPromptWireSnapshot.js";
import {
  AgentNativeToolCallRecoveryPolicy,
  buildAgentNativeToolRepairPrompt,
  extractAgentNativeToolArguments,
  isAgentNativeToolContractFailure,
} from "./AgentNativeToolCallRecovery.js";

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
    /** Host-owned schema/domain validation performed before the result is committed. */
    readonly validate?: (value: unknown) => void;
    readonly signal?: AbortSignal;
    readonly cache?: AgentLanguageModelCacheOptions;
    readonly requestId?: string;
    readonly timingSink?: AgentModelTimingSink;
    readonly wireSnapshotSink?: (snapshot: AgentPromptWireSnapshot) => void | Promise<void>;
  }): Promise<unknown> {
    const startedAt = performance.now();
    const requestId = input.requestId ?? `${this.runtimeLabel}:${input.tool.name}:${Date.now()}`;
    const stage = `${this.runtimeLabel}:${input.tool.name}`;
    const stableTools = [
      { name: input.tool.name, description: input.tool.description, parameters: input.tool.parameters },
    ];
    const stablePrefixRevision = projectAgentStablePrefixRevision({
      systemPrompt: input.systemPrompt,
      tools: stableTools,
    });
    const stablePrefixBytes = projectAgentStablePrefixBytes({
      systemPrompt: input.systemPrompt,
      tools: stableTools,
    });
    const cache = ensureAgentModelCacheStablePrefix(input.cache, {
      discriminator: `${this.runtimeLabel}:${input.tool.name}`,
      stablePrefix: {
        systemPrompt: input.systemPrompt,
        tools: stableTools,
      },
    });
    const cacheStrategy = resolveAgentPromptCacheStrategy(this.model.api);
    const requestedRetention = cache?.retention ?? "none";
    const cacheRetention = projectAgentPromptCacheRetention(cacheStrategy, requestedRetention);
    let userPrompt = input.userPrompt;
    for (let repairAttempt = 0; ; repairAttempt += 1) {
      const requestCharacters = input.systemPrompt.length + userPrompt.length;
      const wireCapture = input.cache ? createAgentPromptWireCapture({}) : undefined;
      const wireSnapshot = (
        usage: Pick<AssistantMessage["usage"], "cacheRead" | "cacheWrite">,
        observation?: ReturnType<typeof resolveAgentPromptCacheObservation>,
      ) =>
        cache && wireCapture
          ? wireCapture.snapshot({
              model: this.model,
              sessionId: cache.sessionId,
              logicalCacheScope: cache.logicalCacheScope,
              providerCacheScope: cache.scope,
              stablePrefixRevision,
              stablePrefixBytes,
              retention: cacheRetention,
              observation: observation ?? resolveAgentPromptCacheObservation(cacheStrategy, usage),
              usage,
            })
          : undefined;
      try {
        const message = await this.provider
          .stream(
            this.model,
            {
              systemPrompt: input.systemPrompt,
              messages: [{ role: "user", content: userPrompt, timestamp: Date.now() }],
              tools: [input.tool],
            } satisfies Context,
            {
              signal: input.signal,
              apiKey: this.configuration.ApiKey || undefined,
              temperature: this.configuration.Temperature,
              timeoutMs: this.configuration.TimeoutMs,
              maxRetries: this.configuration.MaxNetworkRetries,
              maxRetryDelayMs: this.configuration.RetryAfterMaxDelayMs,
              toolChoice:
                repairAttempt === 0 ? projectAgentNativeRequiredToolChoice(this.model.api, input.tool.name) : "auto",
              ...(cache ? { sessionId: cache.scope, cacheRetention } : {}),
              ...(wireCapture
                ? {
                    fetch: wireCapture.fetch,
                    onPayload: wireCapture.onPayload,
                  }
                : {}),
            } as never,
          )
          .result();
        const argumentsValue = extractAgentNativeToolArguments(message, input.tool.name);
        validateArguments(input.validate, argumentsValue, input.tool.name);
        const usage = this.usageResolver.resolve(
          {
            systemPrompt: input.systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
          },
          JSON.stringify(argumentsValue),
          projectAgentPiAssistantUsage(message),
        );
        (this.usageSink ?? recordActiveAgentModelUsage)({ stage, usage });
        const promptCache = wireSnapshot(
          {
            cacheRead: message.usage.cacheRead,
            cacheWrite: message.usage.cacheWrite,
          },
          resolveAgentPromptCacheObservation(cacheStrategy, message.usage),
        );
        await recordWireSnapshot(input.wireSnapshotSink, promptCache);
        await recordTiming(input.timingSink, this.configuration, {
          stage,
          requestId,
          status: "completed",
          durationMs: elapsedMilliseconds(startedAt),
          requestCharacters,
          responseCharacters: JSON.stringify(argumentsValue).length,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          ...(promptCache ? { promptCache } : {}),
        });
        return argumentsValue;
      } catch (error) {
        const canRepair =
          repairAttempt < AgentNativeToolCallRecoveryPolicy.maxRepairAttempts &&
          input.signal?.aborted !== true &&
          isAgentNativeToolContractFailure(error);
        const promptCache = wireSnapshot({ cacheRead: 0, cacheWrite: 0 });
        await recordWireSnapshot(input.wireSnapshotSink, promptCache);
        if (canRepair) {
          userPrompt = `${input.userPrompt}\n\n${buildAgentNativeToolRepairPrompt(input.tool.name, error)}`;
          continue;
        }
        await recordTiming(input.timingSink, this.configuration, {
          stage,
          requestId,
          status: "failed",
          durationMs: elapsedMilliseconds(startedAt),
          requestCharacters,
          responseCharacters: 0,
          ...(promptCache ? { promptCache } : {}),
          error: errorMessage(error),
        });
        throw error;
      }
    }
  }
}

async function recordWireSnapshot(
  sink: ((snapshot: AgentPromptWireSnapshot) => void | Promise<void>) | undefined,
  snapshot: AgentPromptWireSnapshot | undefined,
): Promise<void> {
  if (!sink || !snapshot) return;
  try {
    await sink(snapshot);
  } catch {
    // Wire diagnostics are observational and must never change a model result.
  }
}

function validateArguments(validate: ((value: unknown) => void) | undefined, value: unknown, toolName: string): void {
  if (!validate) return;
  try {
    validate(value);
  } catch (error) {
    if (error instanceof AgentInvalidModelToolArgumentsError) throw error;
    throw new AgentInvalidModelToolArgumentsError(toolName, [error instanceof Error ? error.message : String(error)]);
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
