import type { AssistantMessage, Context, Usage } from "@earendil-works/pi-ai";
import {
  AgentRequiredModelToolCallError,
  AgentInvalidModelToolArgumentsError,
} from "../ModelEndpoints/AgentModelFailureMapper.js";
import { createProviderReportedUsage, type AgentModelUsageSink } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentModelTimingSink } from "../ModelEndpoints/AgentModelTiming.js";
import { ModelRequestTimeoutError, normalizeModelHttpError } from "../ModelEndpoints/ModelHttpErrors.js";
import { errorMessage } from "../Core/AgentErrors.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { AgentPiNativeToolBridgeName } from "../Pi/AgentPiNativeToolBridge.js";
import type { AgentResidentSpeechNativeContinuation } from "./AgentResidentSpeechTypes.js";

export class AgentResidentSpeechNativeClient {
  constructor(private readonly configuration: ResolvedAgentModelProviderConfig) {}

  async project(input: {
    readonly context: Context;
    readonly continuation: AgentResidentSpeechNativeContinuation;
    readonly signal?: AbortSignal;
    readonly sessionId: string;
    readonly usageSink?: AgentModelUsageSink;
    readonly timingSink?: AgentModelTimingSink;
  }): Promise<unknown> {
    const startedAt = performance.now();
    const requestCharacters = JSON.stringify(input.context).length;
    const firstTokenController = new AbortController();
    const maxRequestController = new AbortController();
    const requestSignal = AbortSignal.any(
      [input.signal, firstTokenController.signal, maxRequestController.signal].filter(
        (signal): signal is AbortSignal => signal !== undefined,
      ),
    );
    const firstTokenTimer = startTimeout(firstTokenController, this.configuration.FirstTokenTimeoutMs, "first_token");
    const maxRequestTimer = startTimeout(maxRequestController, this.configuration.MaxRequestMs, "max_request");
    let firstTokenMs: number | undefined;
    try {
      assertNativeBridgeAvailable(input.context);
      const stream = input.continuation.stream({
        context: input.context,
        requiredToolName: AgentPiNativeToolBridgeName,
        signal: requestSignal,
      });
      let message: AssistantMessage | undefined;
      for await (const event of stream) {
        if (isFirstOutputEvent(event.type)) {
          firstTokenMs ??= performance.now() - startedAt;
          firstTokenTimer?.clear();
        }
        if (event.type === "done") {
          message = event.message;
          break;
        }
        if (event.type === "error") {
          throw new Error(event.error.errorMessage ?? "Resident speech provider stream failed.");
        }
      }
      if (!message) throw new Error("Resident speech provider ended without a terminal assistant message.");
      recordUsage(input.usageSink, message.usage);
      const result = extractRequiredToolArguments(message, AgentPiNativeToolBridgeName);
      await recordTiming(input.timingSink, this.configuration, {
        stage: "pi.resident_speech.native",
        requestId: input.sessionId ?? "resident-speech",
        status: "completed",
        firstTokenMs,
        durationMs: performance.now() - startedAt,
        requestCharacters,
        responseCharacters: JSON.stringify(result).length,
        cacheReadTokens: message.usage.cacheRead,
        cacheWriteTokens: message.usage.cacheWrite,
      });
      return result;
    } catch (error) {
      const deadlineFailure = firstTokenController.signal.reason ?? maxRequestController.signal.reason;
      const callerAborted = input.signal?.aborted === true && !deadlineFailure;
      const failure = callerAborted ? (input.signal?.reason ?? error) : (deadlineFailure ?? error);
      await recordTiming(input.timingSink, this.configuration, {
        stage: "pi.resident_speech.native",
        requestId: input.sessionId ?? "resident-speech",
        status: "failed",
        firstTokenMs,
        durationMs: performance.now() - startedAt,
        requestCharacters,
        responseCharacters: 0,
        error: errorMessage(failure),
      });
      throw callerAborted ? failure : normalizeModelHttpError(this.configuration, failure);
    } finally {
      firstTokenTimer?.clear();
      maxRequestTimer?.clear();
    }
  }
}

function assertNativeBridgeAvailable(context: Context): void {
  if (context.tools?.some((tool) => tool.name === AgentPiNativeToolBridgeName)) return;
  throw new Error(`Resident speech native continuation requires the ${AgentPiNativeToolBridgeName} bridge.`);
}

function extractRequiredToolArguments(message: AssistantMessage, toolName: string): Record<string, unknown> {
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    throw new Error(message.errorMessage ?? "Resident speech projection did not complete.");
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

function recordUsage(sink: AgentModelUsageSink | undefined, usage: Usage): void {
  const value = createProviderReportedUsage({
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.totalTokens,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    reasoningTokens: usage.reasoning,
  });
  if (value) sink?.({ stage: "pi.resident_speech.native", usage: value });
}

function isFirstOutputEvent(type: string): boolean {
  return type.endsWith("_delta") || type === "done" || type === "error";
}

function startTimeout(
  controller: AbortController,
  timeoutMs: number,
  kind: "first_token" | "max_request",
): { clear(): void } | undefined {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return undefined;
  const timer = setTimeout(() => controller.abort(new ModelRequestTimeoutError(kind)), timeoutMs);
  timer.unref?.();
  return { clear: () => clearTimeout(timer) };
}

async function recordTiming(
  sink: AgentModelTimingSink | undefined,
  configuration: ResolvedAgentModelProviderConfig,
  record: Parameters<AgentModelTimingSink>[0] extends infer T
    ? Omit<Extract<T, object>, "providerId" | "model">
    : never,
): Promise<void> {
  try {
    await sink?.({ ...record, providerId: configuration.Id, model: configuration.Model });
  } catch {
    // Diagnostics are observational and must not alter the projection result.
  }
}
