import type { AssistantMessage } from "@earendil-works/pi-ai";
import { setTimeout as delay } from "node:timers/promises";
import type { AgentBamlModelRequest } from "../BamlClient/AgentBamlStructuredOutputRunner.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import { throwAbortReason } from "../Core/AgentCancellation.js";
import type { AgentModelUsageSink } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentModelTimingSink } from "../ModelEndpoints/AgentModelTiming.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentNativeToolApiStreams as AgentNativeToolApiStreamMap } from "../ModelEndpoints/AgentNativeToolApiStreams.js";
import { AgentPiModelRequestExecutor } from "../ModelEndpoints/AgentPiModelRequestExecutor.js";
import { projectAgentPiModelRequestContext } from "../ModelEndpoints/AgentPiModelRequestProjection.js";

export interface AgentActionPlannerModelTransportOptions {
  readonly apiStreams?: AgentNativeToolApiStreamMap;
  readonly omitOutputTokenLimit?: boolean;
}

/** BAML text projection over the shared Pi request executor. */
export class AgentActionPlannerModelTransport {
  private readonly executor: AgentPiModelRequestExecutor;
  constructor(
    private readonly config: ResolvedAgentModelProviderConfig,
    usageSink?: AgentModelUsageSink,
    timingSink?: AgentModelTimingSink,
    private readonly options: AgentActionPlannerModelTransportOptions = {},
  ) {
    this.executor = new AgentPiModelRequestExecutor(config, "BAML", usageSink, timingSink, options.apiStreams);
  }

  async complete(
    request: AgentBamlModelRequest,
    signal?: AbortSignal,
    timingSink?: AgentModelTimingSink,
  ): Promise<string> {
    const requestSignal = signal ?? request.signal;
    const attempts = request.retryMode === "pi" ? 1 : this.config.MaxNetworkRetries + 1;
    const emptyResponses: AgentEmptyModelResponseAttempt[] = [];
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const message = await this.executor.execute({
        requestId: request.requestId,
        stage: request.requestId,
        context: projectAgentPiModelRequestContext(request, this.config),
        signal: requestSignal,
        cache: request.cache,
        providerRetries: request.retryMode !== "pi",
        omitOutputTokenLimit: this.options.omitOutputTokenLimit,
        timingSink,
        validate: extractText,
      });
      const text = extractText(message);
      if (text.trim()) return text;
      emptyResponses.push({
        attempt: attempt + 1,
        finishReason: message.stopReason,
        status: message.rawStopReason ?? null,
        outputTokens: message.usage.output,
        reasoningTokens: message.usage.reasoning ?? null,
      });
      if (attempt + 1 < attempts)
        await waitForEmptyResponseRetry(
          Math.min(this.config.RetryMaxDelayMs, this.config.RetryBaseDelayMs * 2 ** attempt),
          requestSignal,
        );
    }
    throw new AgentEmptyModelResponseError(this.config.Id, this.config.Model, emptyResponses);
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

async function waitForEmptyResponseRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwAbortReason(signal);
  try {
    await delay(delayMs, undefined, { signal });
  } catch (error) {
    throwAbortReason(signal);
    throw error;
  }
}
