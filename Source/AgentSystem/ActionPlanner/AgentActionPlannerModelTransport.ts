import { throwIfAborted } from "../Core/AgentCancellation.js";
import type { AgentBamlModelRequest } from "../BamlClient/AgentBamlStructuredOutputRunner.js";
import { createModelProviderMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
import { createModelEndpoint } from "../ModelEndpoints/ModelEndpointTypes.js";
import type { TextGenerationEndpoint } from "../ModelEndpoints/ModelEndpointTypes.js";
import type { AgentLanguageModelStream } from "../ModelEndpoints/AgentLanguageModel.js";
import { ModelHttpClient } from "../ModelEndpoints/ModelHttpClient.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentModelTimingRecord, AgentModelTimingSink } from "../ModelEndpoints/AgentModelTiming.js";
import {
  AgentModelUsageResolver,
  recordActiveAgentModelUsage,
  type AgentModelUsageSink,
  type AgentModelUsageValue,
} from "../ModelEndpoints/AgentModelUsage.js";

export class AgentActionPlannerModelTransport {
  private readonly endpoint: TextGenerationEndpoint;
  private readonly usageResolver: AgentModelUsageResolver;

  constructor(
    private readonly provider: ResolvedAgentModelProviderConfig,
    private readonly usageSink?: AgentModelUsageSink,
    private readonly timingSink?: AgentModelTimingSink,
  ) {
    this.usageResolver = new AgentModelUsageResolver(provider.Model);
    this.endpoint = createModelEndpoint(provider.Endpoint, {
      config: provider,
      http: new ModelHttpClient(provider, createModelProviderMetadata(provider)),
    });
  }

  async complete(request: AgentBamlModelRequest, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    const stream = await this.stream(request, signal);
    let text = "";
    const abort = (): void => stream.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      for await (const chunk of stream) {
        throwIfAborted(signal);
        text = chunk.accumulatedText;
      }
    } finally {
      signal?.removeEventListener("abort", abort);
    }
    throwIfAborted(signal);
    return text;
  }

  async stream(
    request: AgentBamlModelRequest,
    signal?: AbortSignal,
    usageStage = request.requestId.replace(/^action-planner:/, ""),
  ): Promise<AgentLanguageModelStream> {
    throwIfAborted(signal);
    const startedAt = performance.now();
    const stage = usageStage;
    const requestCharacters = requestCharacterCount(request);
    const modelRequest = {
      ...request,
      signal,
    };
    let upstream: AgentLanguageModelStream;
    try {
      upstream = await this.endpoint.stream(modelRequest);
    } catch (error) {
      await this.recordTiming({
        stage,
        requestId: request.requestId,
        status: "failed",
        durationMs: elapsedMilliseconds(startedAt),
        requestCharacters,
        responseCharacters: 0,
        error: errorMessage(error),
      });
      throw error;
    }
    const metadata = upstream.metadata;
    const usageResolver = this.usageResolver;
    const usageSink = this.usageSink;
    let accumulatedText = "";
    let usage: AgentModelUsageValue | undefined;
    let firstTokenMs: number | undefined;
    const timingSink = this.timingSink;
    const recordTiming = async (record: AgentModelTimingRecord): Promise<void> => {
      try {
        await timingSink?.(record);
      } catch {
        // Telemetry must never change the model result.
      }
    };
    const timingContext = {
      stage,
      requestId: request.requestId,
      requestCharacters,
      startedAt,
    };
    const provider = this.provider;
    const chunks = (async function* () {
      try {
        for await (const chunk of upstream) {
          if (chunk.textDelta.length > 0) firstTokenMs ??= elapsedMilliseconds(startedAt);
          accumulatedText = chunk.accumulatedText;
          yield chunk;
        }
        usage = usageResolver.resolve(modelRequest, accumulatedText, upstream.usage);
        const call = {
          stage: usageStage,
          usage,
        };
        (usageSink ?? recordActiveAgentModelUsage)(call);
        await recordTiming({
          stage: timingContext.stage,
          requestId: timingContext.requestId,
          providerId: provider.Id,
          model: provider.Model,
          status: "completed",
          firstTokenMs,
          durationMs: elapsedMilliseconds(timingContext.startedAt),
          requestCharacters: timingContext.requestCharacters,
          responseCharacters: accumulatedText.length,
        });
      } catch (error) {
        await recordTiming({
          stage: timingContext.stage,
          requestId: timingContext.requestId,
          providerId: provider.Id,
          model: provider.Model,
          status: "failed",
          firstTokenMs,
          durationMs: elapsedMilliseconds(timingContext.startedAt),
          requestCharacters: timingContext.requestCharacters,
          responseCharacters: accumulatedText.length,
          error: errorMessage(error),
        });
        throw error;
      }
    })();
    return {
      metadata,
      get usage() {
        return usage;
      },
      abort: () => upstream.abort(),
      [Symbol.asyncIterator]: () => chunks,
    };
  }

  private async recordTiming(record: Omit<AgentModelTimingRecord, "providerId" | "model">): Promise<void> {
    try {
      await this.timingSink?.({
        ...record,
        providerId: this.provider.Id,
        model: this.provider.Model,
      });
    } catch {
      // Telemetry must never mask the provider failure.
    }
  }
}

function requestCharacterCount(request: AgentBamlModelRequest): number {
  return request.systemPrompt.length + request.messages.reduce((total, message) => total + message.content.length, 0);
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
