import {
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type Provider,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { AgentBamlModelRequest } from "../BamlClient/AgentBamlStructuredOutputRunner.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { errorMessage } from "../Core/AgentErrors.js";
import type {
  AgentLanguageModelImageAttachment,
  AgentLanguageModelMessage,
} from "../ModelEndpoints/AgentLanguageModel.js";
import { ModelRequestTimeoutError, normalizeModelHttpError } from "../ModelEndpoints/ModelHttpErrors.js";
import {
  AgentModelUsageResolver,
  recordActiveAgentModelUsage,
  type AgentModelUsageSink,
  type AgentModelUsageValue,
} from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentModelTimingRecord, AgentModelTimingSink } from "../ModelEndpoints/AgentModelTiming.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentNativeToolApi } from "../ModelEndpoints/AgentModelEndpointContract.js";
import type { AgentNativeToolApiStreams as AgentNativeToolApiStreamMap } from "../ModelEndpoints/AgentNativeToolApiStreams.js";
import { createAgentPiConfiguredProvider } from "../ModelEndpoints/AgentPiConfiguredProvider.js";
import { projectAgentPiAssistantUsage } from "../ModelEndpoints/AgentPiModelUsage.js";

export interface AgentActionPlannerModelTransportOptions {
  readonly apiStreams?: AgentNativeToolApiStreamMap;
  readonly omitOutputTokenLimit?: boolean;
}

/**
 * BAML's structured-output bridge. Pi owns the vendor wire protocol; this
 * class owns only BAML's text boundary, accounting, and request deadlines.
 */
export class AgentActionPlannerModelTransport {
  private readonly model: Model<AgentNativeToolApi>;
  private readonly provider: Provider<AgentNativeToolApi>;
  private readonly usageResolver: AgentModelUsageResolver;
  private readonly omitOutputTokenLimit: boolean;

  constructor(
    private readonly config: ResolvedAgentModelProviderConfig,
    private readonly usageSink?: AgentModelUsageSink,
    private readonly timingSink?: AgentModelTimingSink,
    options: AgentActionPlannerModelTransportOptions = {},
  ) {
    ({ model: this.model, provider: this.provider } = createAgentPiConfiguredProvider(
      config,
      "BAML",
      options.apiStreams,
    ));
    this.usageResolver = new AgentModelUsageResolver(config.Model);
    this.omitOutputTokenLimit = options.omitOutputTokenLimit === true;
  }

  async complete(request: AgentBamlModelRequest, signal?: AbortSignal): Promise<string> {
    const attempts = this.config.MaxNetworkRetries + 1;
    const emptyResponses: AgentEmptyModelResponseAttempt[] = [];
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const response = await this.collectCompletion(request, signal);
      if (response.text.trim().length > 0) return response.text;
      emptyResponses.push({
        attempt: attempt + 1,
        finishReason: response.finishReason,
        status: response.status,
        outputTokens: response.usage?.outputTokens ?? null,
        reasoningTokens: response.usage?.reasoningTokens ?? null,
      });
      if (attempt + 1 >= attempts) {
        throw new AgentEmptyModelResponseError(this.config.Id, this.config.Model, emptyResponses);
      }
      await waitForEmptyResponseRetry(this.retryDelay(attempt), signal);
    }
    throw new AgentEmptyModelResponseError(this.config.Id, this.config.Model, emptyResponses);
  }

  private async collectCompletion(
    request: AgentBamlModelRequest,
    signal?: AbortSignal,
  ): Promise<{
    text: string;
    finishReason: string | null;
    status: string | null;
    usage?: AgentModelUsageValue;
  }> {
    throwIfAborted(signal);
    const startedAt = performance.now();
    const requestCharacters = requestCharacterCount(request);
    const stage = request.requestId.replace(/^action-planner:/, "");
    const firstTokenController = new AbortController();
    const maxRequestController = new AbortController();
    const requestSignal = AbortSignal.any(
      [signal, firstTokenController.signal, maxRequestController.signal].filter(
        (candidate): candidate is AbortSignal => candidate !== undefined,
      ),
    );
    const firstTokenTimer = startTimeout(firstTokenController, this.config.FirstTokenTimeoutMs, "first_token");
    const maxRequestTimer = startTimeout(maxRequestController, this.config.MaxRequestMs, "max_request");
    let firstTokenMs: number | undefined;
    let message: AssistantMessage | undefined;
    try {
      const context = projectBamlContext(request);
      const streamOptions = {
        signal: requestSignal,
        apiKey: this.config.ApiKey || undefined,
        temperature: this.config.Temperature,
        timeoutMs: this.config.TimeoutMs,
        maxRetries: this.config.MaxNetworkRetries,
        maxRetryDelayMs: this.config.RetryAfterMaxDelayMs,
        ...(request.cache ? { sessionId: request.cache.scope, cacheRetention: request.cache.retention } : {}),
        ...(!this.omitOutputTokenLimit && this.config.MaxOutputTokens > 0
          ? { maxTokens: this.config.MaxOutputTokens }
          : {}),
      } satisfies SimpleStreamOptions;
      const stream = this.omitOutputTokenLimit
        ? this.provider.stream(this.model, context, streamOptions as never)
        : this.provider.streamSimple(this.model, context, streamOptions);
      for await (const event of stream) {
        if (isFirstOutputEvent(event.type)) {
          firstTokenMs ??= elapsedMilliseconds(startedAt);
          firstTokenTimer?.clear();
        }
        if (event.type === "done") {
          message = event.message;
          break;
        }
        if (event.type === "error") {
          throw new Error(event.error.errorMessage ?? "Pi provider stream failed.");
        }
      }
      if (!message) throw new Error("Pi provider stream ended without a terminal assistant message.");
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        throw new Error(message.errorMessage ?? "Pi provider completed without a usable response.");
      }
      const text = extractText(message);
      const usage = this.usageResolver.resolve(request, text, projectAgentPiAssistantUsage(message));
      (this.usageSink ?? recordActiveAgentModelUsage)({ stage, usage });
      await this.recordTiming({
        stage,
        requestId: request.requestId,
        status: "completed",
        firstTokenMs,
        durationMs: elapsedMilliseconds(startedAt),
        requestCharacters,
        responseCharacters: text.length,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
      });
      return {
        text,
        finishReason: message.stopReason,
        status: message.rawStopReason ?? null,
        usage,
      };
    } catch (error) {
      const deadlineFailure = firstTokenController.signal.reason ?? maxRequestController.signal.reason;
      const aborted = signal?.aborted === true && !deadlineFailure;
      const failure = aborted ? (signal.reason ?? error) : (deadlineFailure ?? error);
      await this.recordTiming({
        stage,
        requestId: request.requestId,
        status: "failed",
        firstTokenMs,
        durationMs: elapsedMilliseconds(startedAt),
        requestCharacters,
        responseCharacters: 0,
        error: errorMessage(failure),
      });
      throw aborted ? failure : normalizeModelHttpError(this.config, failure);
    } finally {
      firstTokenTimer?.clear();
      maxRequestTimer?.clear();
    }
  }

  private retryDelay(attempt: number): number {
    return Math.min(this.config.RetryMaxDelayMs, this.config.RetryBaseDelayMs * 2 ** attempt);
  }

  private async recordTiming(record: Omit<AgentModelTimingRecord, "providerId" | "model">): Promise<void> {
    try {
      await this.timingSink?.({
        ...record,
        providerId: this.config.Id,
        model: this.config.Model,
      });
    } catch {
      // Telemetry must never change the planner result.
    }
  }
}

class AgentEmptyModelResponseError extends AgentBaseError {
  constructor(
    readonly providerId: string,
    readonly model: string,
    readonly responses: readonly AgentEmptyModelResponseAttempt[],
  ) {
    super(
      `Model ${providerId}/${model} completed without final text after ${responses.length} attempt(s). ` +
        `Completion diagnostics: ${JSON.stringify(responses)}.`,
    );
  }

  get attempts(): number {
    return this.responses.length;
  }
}

interface AgentEmptyModelResponseAttempt {
  readonly attempt: number;
  readonly finishReason: string | null;
  readonly status: string | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
}

function projectBamlContext(request: AgentBamlModelRequest): Context {
  const systemSections = [
    request.systemPrompt,
    ...request.messages.filter(isSystemMessage).map((message) => message.content),
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  const messages = request.messages.filter((message) => !isSystemMessage(message)).map(projectBamlMessage);
  if (messages.length === 0) throw new Error("BAML request did not include a model message.");
  return {
    ...(systemSections.length > 0 ? { systemPrompt: systemSections.join("\n\n") } : {}),
    messages,
  };
}

function isSystemMessage(message: AgentLanguageModelMessage): boolean {
  return message.role === "system" || message.role === "developer";
}

function projectBamlMessage(message: AgentLanguageModelMessage): Message {
  if (message.role === "user") {
    return { role: "user", content: projectUserContent(message), timestamp: Date.now() };
  }
  if (message.role === "assistant") {
    return {
      role: "assistant",
      api: "pi-messages",
      provider: "senera",
      model: "baml-history",
      content: [{ type: "text", text: message.content }],
      usage: emptyUsage(),
      stopReason: "stop",
      timestamp: Date.now(),
    };
  }
  throw new Error(`Unsupported BAML message role: ${message.role}.`);
}

function projectUserContent(message: AgentLanguageModelMessage) {
  if (!message.attachments?.length) return message.content;
  return [{ type: "text" as const, text: message.content }, ...message.attachments.map(projectImageAttachment)];
}

function projectImageAttachment(attachment: AgentLanguageModelImageAttachment) {
  return {
    type: "image" as const,
    data: attachment.data,
    mimeType: attachment.mimeType,
  };
}

function extractText(message: AssistantMessage): string {
  const toolCall = message.content.find((block) => block.type === "toolCall");
  if (toolCall) {
    throw new Error(`Pi BAML provider returned an unexpected tool call: ${toolCall.name}.`);
  }
  return message.content
    .filter((block): block is Extract<AssistantMessage["content"][number], { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function emptyUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function isFirstOutputEvent(type: string): boolean {
  return type === "text_delta" || type === "thinking_delta" || type === "done" || type === "error";
}

function requestCharacterCount(request: AgentBamlModelRequest): number {
  return request.systemPrompt.length + request.messages.reduce((total, message) => total + message.content.length, 0);
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function startTimeout(
  controller: AbortController,
  timeoutMs: number,
  kind: "first_token" | "max_request",
): { clear(): void } | undefined {
  if (timeoutMs === -1) return undefined;
  const timer = setTimeout(() => controller.abort(new ModelRequestTimeoutError(kind)), timeoutMs);
  return { clear: () => clearTimeout(timer) };
}

function waitForEmptyResponseRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      cleanup();
      reject(signal?.reason ?? new Error("Model request was aborted."));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
