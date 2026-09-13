import type { AssistantMessage, Context, Usage } from "@earendil-works/pi-ai";
import { createProviderReportedUsage, type AgentModelUsageSink } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentModelTimingSink } from "../ModelEndpoints/AgentModelTiming.js";
import { ModelRequestTimeoutError, normalizeModelHttpError } from "../ModelEndpoints/ModelHttpErrors.js";
import { errorMessage } from "../Core/AgentErrors.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { AgentPiNativeToolBridgeName } from "../Pi/AgentPiNativeToolBridge.js";
import type { AgentResidentSpeechNativeContinuation } from "./AgentResidentSpeechTypes.js";
import {
  AgentNativeToolCallRecoveryPolicy,
  buildAgentNativeToolRepairPrompt,
  extractAgentNativeToolArguments,
  isAgentNativeToolContractFailure,
} from "../ModelEndpoints/AgentNativeToolCallRecovery.js";

export class AgentResidentSpeechNativeClient {
  constructor(private readonly configuration: ResolvedAgentModelProviderConfig) {}

  async project(input: {
    readonly context: Context;
    readonly continuation: AgentResidentSpeechNativeContinuation;
    readonly signal?: AbortSignal;
    readonly sessionId: string;
    /** Validates the sidecar envelope before the runtime commits the utterance. */
    readonly validate?: (value: unknown) => void;
    readonly usageSink?: AgentModelUsageSink;
    readonly timingSink?: AgentModelTimingSink;
  }): Promise<unknown> {
    const startedAt = performance.now();
    let context = input.context;
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
      assertNativeBridgeAvailable(context);
      for (let repairAttempt = 0; ; repairAttempt += 1) {
        const stream = input.continuation.stream({
          context,
          requiredToolName: AgentPiNativeToolBridgeName,
          toolChoice: repairAttempt === 0 ? "required" : "auto",
          signal: requestSignal,
        });
        let message: AssistantMessage | undefined;
        try {
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
          const result = extractAgentNativeToolArguments(message, AgentPiNativeToolBridgeName);
          input.validate?.(result);
          await recordTiming(input.timingSink, this.configuration, {
            stage: "pi.resident_speech.native",
            requestId: input.sessionId ?? "resident-speech",
            status: "completed",
            firstTokenMs,
            durationMs: performance.now() - startedAt,
            requestCharacters: JSON.stringify(context).length,
            responseCharacters: JSON.stringify(result).length,
            cacheReadTokens: message.usage.cacheRead,
            cacheWriteTokens: message.usage.cacheWrite,
          });
          return result;
        } catch (error) {
          const canRepair =
            repairAttempt < AgentNativeToolCallRecoveryPolicy.maxRepairAttempts &&
            input.signal?.aborted !== true &&
            isAgentNativeToolContractFailure(error);
          if (!canRepair) throw error;
          context = {
            ...context,
            messages: [
              ...context.messages,
              {
                role: "user",
                content: buildAgentNativeToolRepairPrompt(AgentPiNativeToolBridgeName, error),
                timestamp: Date.now(),
              },
            ],
          };
        }
      }
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
        requestCharacters: JSON.stringify(context).length,
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
