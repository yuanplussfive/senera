import {
  normalizeContext,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Tool,
} from "@earendil-works/pi-ai";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentLanguageModelCacheOptions } from "./AgentLanguageModel.js";
import { createAgentPiConfiguredProvider } from "./AgentPiConfiguredProvider.js";
import { ModelRequestTimeoutError, normalizeModelHttpError } from "./ModelHttpErrors.js";
import { AgentModelResponseBudgetError, AgentPiModelResponseBudget } from "./ModelResponseBudget.js";
import { throwAbortReason, awaitWithAbortSignal } from "../Core/AgentCancellation.js";
import type { AgentNativeRequiredToolChoice } from "./AgentModelEndpointContract.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { AgentModelUsageResolver, recordActiveAgentModelUsage, type AgentModelUsageSink } from "./AgentModelUsage.js";
import { projectAgentPiAssistantUsage } from "./AgentPiModelUsage.js";
import type { AgentModelTimingSink } from "./AgentModelTiming.js";
import type { AgentNativeToolApiStreams } from "./AgentNativeToolApiStreams.js";
import type { AgentPromptWireSnapshot } from "./AgentPromptWireSnapshot.js";
import {
  createAgentPromptWireCapture,
  projectAgentPromptCacheRetention,
  projectAgentStablePrefixBytes,
  projectAgentStablePrefixRevision,
  resolveAgentPromptCacheObservation,
  resolveAgentPromptCacheStrategy,
} from "./AgentPromptWireSnapshot.js";

export interface AgentPiModelExecutionRequest {
  readonly requestId: string;
  readonly stage: string;
  readonly context: Context;
  readonly signal?: AbortSignal;
  readonly cache?: AgentLanguageModelCacheOptions;
  readonly toolChoice?: AgentNativeRequiredToolChoice;
  readonly stream?: (signal: AbortSignal) => AssistantMessageEventStream;
  readonly usageSink?: AgentModelUsageSink;
  readonly providerRetries?: boolean;
  readonly omitOutputTokenLimit?: boolean;
  readonly validate?: (message: AssistantMessage) => void;
  readonly timingSink?: AgentModelTimingSink;
  readonly wireSnapshotSink?: (snapshot: AgentPromptWireSnapshot) => void | Promise<void>;
}

/** One Pi wire path for auxiliary text, image and structured requests. */
export class AgentPiModelRequestExecutor {
  private readonly pi;
  private readonly usageResolver;

  constructor(
    private readonly configuration: ResolvedAgentModelProviderConfig,
    purpose: string,
    private readonly usageSink?: AgentModelUsageSink,
    private readonly timingSink?: AgentModelTimingSink,
    apiStreams?: typeof AgentNativeToolApiStreams,
  ) {
    this.pi = createAgentPiConfiguredProvider(configuration, purpose, apiStreams);
    this.usageResolver = new AgentModelUsageResolver(configuration.Model);
  }

  get api() {
    return this.pi.model.api;
  }

  async execute(input: AgentPiModelExecutionRequest): Promise<AssistantMessage> {
    throwAbortReason(input.signal);
    const startedAt = performance.now();
    const firstToken = new AbortController();
    const deadline = new AbortController();
    const lifetime = new AbortController();
    const signal = AbortSignal.any(
      [input.signal, firstToken.signal, deadline.signal, lifetime.signal].filter(
        (value): value is AbortSignal => value !== undefined,
      ),
    );
    const responseBudget = new AgentPiModelResponseBudget(this.configuration);
    const firstTokenTimer = startDeadline(firstToken, this.configuration.FirstTokenTimeoutMs, "first_token");
    const requestTimer = startDeadline(deadline, this.configuration.MaxRequestMs, "max_request");
    const context = normalizeContext(input.context);
    const requestCharacters = JSON.stringify(context).length;
    const stablePrefix = {
      systemPrompt: input.context.systemPrompt ?? "",
      tools: (input.context.tools ?? []).map(projectStableTool),
    };
    const strategy = resolveAgentPromptCacheStrategy(this.pi.model.api);
    const retention = projectAgentPromptCacheRetention(strategy, input.cache?.retention ?? "none");
    const capture = input.cache ? createAgentPromptWireCapture({}) : undefined;
    let firstTokenMs: number | undefined;
    let responseCharacters = 0;
    let message: AssistantMessage | undefined;
    let snapshot: AgentPromptWireSnapshot | undefined;
    let wireCompleted = false;
    let usageRecorded = false;
    const recordUsage = () => {
      if (!message || usageRecorded) return;
      responseCharacters = JSON.stringify(message.content).length;
      const usage = this.usageResolver.resolve(
        input.context,
        JSON.stringify(message.content),
        projectAgentPiAssistantUsage(message),
      );
      (input.usageSink ?? this.usageSink ?? recordActiveAgentModelUsage)({ stage: input.stage, usage });
      usageRecorded = true;
    };
    const projectSnapshot = () =>
      input.cache && capture
        ? capture.snapshot({
            model: this.pi.model,
            sessionId: input.cache.sessionId,
            logicalCacheScope: input.cache.logicalCacheScope,
            providerCacheScope: input.cache.scope,
            stablePrefixRevision: input.cache.stablePrefixRevision ?? projectAgentStablePrefixRevision(stablePrefix),
            stablePrefixBytes: input.cache.stablePrefixBytes ?? projectAgentStablePrefixBytes(stablePrefix),
            retention,
            observation: resolveAgentPromptCacheObservation(
              strategy,
              message?.usage ?? { cacheRead: 0, cacheWrite: 0 },
            ),
            usage: message?.usage ?? { cacheRead: 0, cacheWrite: 0 },
          })
        : undefined;
    const report = async (status: "completed" | "failed", error?: unknown) => {
      snapshot = projectSnapshot();
      // Observational sinks cannot change a model request's result.
      await Promise.allSettled([
        Promise.resolve().then(() =>
          (input.timingSink ?? this.timingSink)?.({
            stage: input.stage,
            requestId: input.requestId,
            providerId: this.configuration.Id,
            model: this.configuration.Model,
            status,
            firstTokenMs,
            durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
            requestCharacters,
            responseCharacters,
            ...(message
              ? { cacheReadTokens: message.usage.cacheRead, cacheWriteTokens: message.usage.cacheWrite }
              : {}),
            ...(snapshot ? { promptCache: snapshot } : {}),
            ...(error === undefined ? {} : { error: errorMessage(error) }),
          }),
        ),
        Promise.resolve().then(() => (snapshot ? input.wireSnapshotSink?.(snapshot) : undefined)),
      ]);
    };
    try {
      const options = {
        signal,
        apiKey: this.configuration.ApiKey || undefined,
        temperature: this.configuration.Temperature,
        timeoutMs: this.configuration.TimeoutMs,
        maxRetries: input.providerRetries === false ? 0 : this.configuration.MaxNetworkRetries,
        maxRetryDelayMs: this.configuration.RetryAfterMaxDelayMs,
        ...(input.cache ? { sessionId: input.cache.scope, cacheRetention: retention } : {}),
        ...(capture ? { fetch: capture.fetch, onPayload: capture.onPayload } : {}),
        ...(input.omitOutputTokenLimit || this.configuration.MaxOutputTokens <= 0
          ? {}
          : { maxTokens: this.configuration.MaxOutputTokens }),
      };
      const stream = input.stream
        ? input.stream(signal)
        : input.omitOutputTokenLimit || input.toolChoice !== undefined
          ? this.pi.provider.stream(this.pi.model, context, {
              ...options,
              ...(input.toolChoice === undefined ? {} : { toolChoice: input.toolChoice }),
            })
          : this.pi.provider.streamSimple(this.pi.model, context, options);
      const iterator = stream[Symbol.asyncIterator]();
      for (;;) {
        const next = await awaitWithAbortSignal(iterator.next(), signal);
        if (next.done) break;
        const event = next.value;
        if (event.type === "done" || event.type === "error") {
          message = event.type === "done" ? event.message : event.error;
          if (event.type === "done" || projectAgentPiAssistantUsage(message)) recordUsage();
        }
        responseBudget.observe(event);
        if (
          event.type === "text_delta" ||
          event.type === "thinking_delta" ||
          event.type === "toolcall_delta" ||
          event.type === "done"
        ) {
          firstTokenMs ??= Math.max(0, Math.round(performance.now() - startedAt));
          if (firstTokenTimer) clearTimeout(firstTokenTimer);
        }
        if (event.type === "done") {
          break;
        }
        if (event.type === "error") {
          throw new Error(event.error.errorMessage ?? "Pi provider request failed.");
        }
      }
      throwAbortReason(signal);
      if (!message) throw new Error("Pi provider ended without a terminal assistant message.");
      if (message.stopReason === "error" || message.stopReason === "aborted")
        throw new Error(message.errorMessage ?? "Pi provider request did not complete.");
      wireCompleted = true;
      input.validate?.(message);
      await report("completed");
      return message;
    } catch (error) {
      const timeout = firstToken.signal.reason ?? deadline.signal.reason;
      const failure = timeout ?? (input.signal?.aborted ? input.signal.reason : error);
      await report("failed", failure);
      if (timeout || input.signal?.aborted) throw failure;
      if (failure instanceof AgentModelResponseBudgetError) throw failure;
      if (wireCompleted) throw failure;
      throw normalizeModelHttpError(this.configuration, failure);
    } finally {
      lifetime.abort();
      if (firstTokenTimer) clearTimeout(firstTokenTimer);
      if (requestTimer) clearTimeout(requestTimer);
    }
  }
}

function projectStableTool(tool: Tool) {
  return { name: tool.name, description: tool.description, parameters: tool.parameters };
}

function startDeadline(controller: AbortController, milliseconds: number, kind: "first_token" | "max_request") {
  if (milliseconds === -1) return undefined;
  return setTimeout(() => controller.abort(new ModelRequestTimeoutError(kind)), milliseconds);
}
