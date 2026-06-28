import { AgentEventKinds, emitAgentEvent } from "../AgentEvent.js";
import type {
  AgentLanguageModel,
  AgentLanguageModelRequest,
  AgentLanguageModelResponse,
  AgentLanguageModelStream,
  AgentLanguageModelStreamChunk,
} from "./AgentLanguageModel.js";
import { resolveModelProviderConfig } from "../AgentDefaults.js";
import {
  createModelProviderMetadata,
  type AgentModelProviderMetadata,
} from "./AgentModelMetadata.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { ModelHttpClient } from "./ModelHttpClient.js";
import type {
  TextGenerationEndpoint,
} from "./ModelEndpointTypes.js";
import { createModelEndpoint } from "./ModelEndpointTypes.js";

type ModelProviderConfig = ReturnType<typeof resolveModelProviderConfig>;

export class AgentModelEndpointClient implements AgentLanguageModel {
  readonly metadata: AgentModelProviderMetadata;

  private readonly providerConfig: ModelProviderConfig;
  private readonly endpoint: TextGenerationEndpoint;

  constructor(config: AgentSystemConfig, modelProviderId?: string) {
    this.providerConfig = resolveModelProviderConfig(config, modelProviderId);
    if (!this.providerConfig.ApiKey?.trim()) {
      throw new Error(`缺少模型 API Key。请在配置文件中填写 ModelProviders[].ApiKey。 provider=${this.providerConfig.Id}`);
    }

    this.metadata = createModelProviderMetadata(this.providerConfig);
    this.endpoint = createModelEndpoint(this.providerConfig.Endpoint, {
      config: this.providerConfig,
      http: new ModelHttpClient(this.providerConfig, this.metadata),
    });
  }

  async complete(request: AgentLanguageModelRequest): Promise<AgentLanguageModelResponse> {
    if (this.providerConfig.Stream) {
      return { text: await this.collectStream(request) };
    }

    await this.emitStarted(request);
    const result = await this.endpoint.complete(request);

    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.ModelCompleted,
      context: {
        requestId: request.requestId,
        step: request.step,
      },
      data: {
        text: result.text,
        provider: this.metadata,
      },
    });

    return result;
  }

  async stream(request: AgentLanguageModelRequest): Promise<AgentLanguageModelStream> {
    await this.emitStarted(request);
    const stream = await this.endpoint.stream(request);

    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.ModelStreamOpened,
      context: {
        requestId: request.requestId,
        step: request.step,
      },
      data: {
        provider: this.metadata,
      },
    });

    let accumulatedText = "";
    const self = this;
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
    })();

    return {
      metadata: self.metadata,
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

  private async collectStream(request: AgentLanguageModelRequest): Promise<string> {
    const stream = await this.stream(request);
    let text = "";
    for await (const chunk of stream) {
      text = chunk.accumulatedText;
    }
    return text;
  }
}
