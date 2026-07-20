import { AgentEventKinds, emitAgentEvent } from "../Events/AgentEvent.js";
import type {
  AgentLanguageModel,
  AgentLanguageModelRequest,
  AgentLanguageModelResponse,
  AgentLanguageModelStream,
  AgentLanguageModelStreamChunk,
} from "./AgentLanguageModel.js";
import { resolveModelProviderConfig } from "../AgentDefaults.js";
import { createModelProviderMetadata, type AgentModelProviderMetadata } from "./AgentModelMetadata.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { ModelHttpClient } from "./ModelHttpClient.js";
import type { TextGenerationEndpoint } from "./ModelEndpointTypes.js";
import { createModelEndpoint } from "./ModelEndpointTypes.js";
import { AgentModelUsageResolver, type AgentModelUsageValue } from "./AgentModelUsage.js";

type ModelProviderConfig = ReturnType<typeof resolveModelProviderConfig>;

export class AgentModelEndpointClient implements AgentLanguageModel {
  readonly metadata: AgentModelProviderMetadata;

  private readonly providerConfig: ModelProviderConfig;
  private readonly endpoint: TextGenerationEndpoint;
  private readonly usageResolver: AgentModelUsageResolver;

  constructor(config: AgentSystemConfig, modelProviderId?: string) {
    this.providerConfig = resolveModelProviderConfig(config, modelProviderId);
    if (!this.providerConfig.ApiKey?.trim()) {
      throw new Error(
        agentErrorMessage("model.apiKeyMissing", {
          providerId: this.providerConfig.Id,
        }),
      );
    }

    this.metadata = createModelProviderMetadata(this.providerConfig);
    this.usageResolver = new AgentModelUsageResolver(this.providerConfig.Model);
    this.endpoint = createModelEndpoint(this.providerConfig.Endpoint, {
      config: this.providerConfig,
      http: new ModelHttpClient(this.providerConfig, this.metadata),
    });
  }

  async complete(request: AgentLanguageModelRequest): Promise<AgentLanguageModelResponse> {
    if (this.providerConfig.Stream) {
      return this.collectStream(request);
    }

    await this.emitStarted(request);
    const result = await this.endpoint.complete(request);
    const usage = this.usageResolver.resolve(request, result.text, result.usage);

    await this.emitCompleted(request, result.text, usage);

    return { text: result.text, usage };
  }

  async stream(request: AgentLanguageModelRequest): Promise<AgentLanguageModelStream> {
    await this.emitStarted(request);
    const stream = await this.endpoint.stream(request);

    let accumulatedText = "";
    let usage: AgentModelUsageValue | undefined;
    const metadata = this.metadata;
    const usageResolver = this.usageResolver;
    const emitCompleted = this.emitCompleted.bind(this);
    const chunks = (async function* (): AsyncGenerator<AgentLanguageModelStreamChunk> {
      for await (const chunk of stream) {
        accumulatedText += chunk.textDelta;
        await emitAgentEvent(request.onEvent, {
          kind: AgentEventKinds.ModelDelta,
          context: {
            requestId: request.requestId,
            step: request.step,
          },
          data: {
            text: chunk.textDelta,
          },
        });
        yield {
          textDelta: chunk.textDelta,
          accumulatedText,
        };
      }
      usage = usageResolver.resolve(request, accumulatedText, stream.usage);
      await emitCompleted(request, accumulatedText, usage);
    })();

    return {
      metadata,
      get usage() {
        return usage;
      },
      abort: () => stream.abort(),
      [Symbol.asyncIterator]: () => chunks,
    };
  }

  private async emitStarted(request: AgentLanguageModelRequest): Promise<void> {
    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.ModelStarted,
      context: {
        requestId: request.requestId,
        step: request.step,
      },
      data: {
        model: this.providerConfig.Model,
        provider: this.metadata,
      },
    });
  }

  private async collectStream(request: AgentLanguageModelRequest): Promise<AgentLanguageModelResponse> {
    const stream = await this.stream(request);
    let text = "";
    for await (const chunk of stream) {
      text = chunk.accumulatedText;
    }
    return { text, usage: stream.usage };
  }

  private async emitCompleted(
    request: AgentLanguageModelRequest,
    text: string,
    usage: AgentModelUsageValue,
  ): Promise<void> {
    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.ModelCompleted,
      context: {
        requestId: request.requestId,
        step: request.step,
      },
      data: {
        text,
        provider: this.metadata,
        usage,
      },
    });
  }
}
