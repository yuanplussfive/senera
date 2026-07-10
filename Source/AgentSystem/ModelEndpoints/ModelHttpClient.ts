import type {
  AgentLanguageModelStream,
} from "./AgentLanguageModel.js";
import type {
  JsonObject,
  ModelHttpPathSegment,
  ModelProviderConfig,
} from "./ModelEndpointTypes.js";
import type { AgentModelProviderMetadata } from "./AgentModelMetadata.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { combineAbortSignals, createModelRequestLifetime } from "./ModelHttpAbort.js";
import { normalizeModelHttpError } from "./ModelHttpErrors.js";
import { parseModelHttpJsonObject } from "./ModelHttpJson.js";
import { fetchModelHttpWithRetries } from "./ModelHttpRetry.js";
import { createModelHttpUrl } from "./ModelHttpUrl.js";
import { parseModelEventStreamText } from "./ModelSseStreamParser.js";

export { rawPathSegment } from "./ModelHttpUrl.js";

export class ModelHttpClient {
  constructor(
    private readonly config: ModelProviderConfig,
    private readonly metadata: AgentModelProviderMetadata,
  ) {}

  async postJson(
    path: ModelHttpPathSegment[],
    payload: unknown,
    headers: HeadersInit,
    options: { signal?: AbortSignal } = {},
  ): Promise<JsonObject> {
    const lifetime = createModelRequestLifetime(this.config, options.signal);
    try {
      const response = await this.fetchWithRetries(path, {
        method: "POST",
        headers: this.headers(headers),
        body: JSON.stringify(payload),
        signal: lifetime.signal,
      });
      return parseModelHttpJsonObject(await response.json());
    } catch (error) {
      throw this.normalizeError(error);
    } finally {
      lifetime.dispose();
    }
  }

  async postSseStream(
    path: ModelHttpPathSegment[],
    payload: unknown,
    headers: HeadersInit,
    extractText: (event: JsonObject) => string,
    query?: Record<string, string>,
    options: { signal?: AbortSignal } = {},
  ): Promise<AgentLanguageModelStream> {
    const controller = new AbortController();
    const requestSignal = options.signal
      ? combineAbortSignals(options.signal, controller.signal)
      : controller.signal;
    const lifetime = createModelRequestLifetime(this.config, requestSignal);
    const response = await this.openSseResponse(path, payload, headers, query, lifetime.signal)
      .catch((error) => {
        lifetime.dispose();
        throw error;
      });

    const chunks = parseModelEventStreamText(response.body, extractText, {
      requestSignal: lifetime.signal,
      firstTokenTimeoutMs: this.config.FirstTokenTimeoutMs,
      dispose: lifetime.dispose,
      normalizeError: (error) => this.normalizeError(error),
    });
    return {
      metadata: this.metadata,
      abort: () => {
        controller.abort();
        lifetime.dispose();
      },
      [Symbol.asyncIterator]: () => chunks,
    };
  }

  private async openSseResponse(
    path: ModelHttpPathSegment[],
    payload: unknown,
    headers: HeadersInit,
    query: Record<string, string> | undefined,
    signal: AbortSignal,
  ): Promise<Response & { body: ReadableStream<Uint8Array> }> {
    try {
      const response = await this.fetchWithRetries(path, {
        method: "POST",
        headers: {
          ...this.headers(headers),
          Accept: "text/event-stream",
        },
        body: JSON.stringify(payload),
        signal,
      }, query);
      if (!response.body) {
        throw new Error(agentErrorMessage("model.readableStreamMissing"));
      }
      return response as Response & { body: ReadableStream<Uint8Array> };
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  private fetchWithRetries(
    path: ModelHttpPathSegment[],
    init: RequestInit,
    query?: Record<string, string>,
  ): Promise<Response> {
    return fetchModelHttpWithRetries(
      this.config,
      createModelHttpUrl(this.config, path, query),
      init,
    );
  }

  private headers(headers: HeadersInit): HeadersInit {
    return {
      "content-type": "application/json",
      ...headers,
    };
  }

  private normalizeError(error: unknown): Error {
    return normalizeModelHttpError(this.config, error);
  }
}
