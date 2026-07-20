import type { AgentLanguageModelStream } from "./AgentLanguageModel.js";
import type { JsonObject, ModelHttpPathSegment, ModelProviderConfig } from "./ModelEndpointTypes.js";
import type { AgentModelProviderMetadata } from "./AgentModelMetadata.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { combineAbortSignals, createModelRequestLifetime, disposeCombinedAbortSignal } from "./ModelHttpAbort.js";
import { normalizeModelHttpError } from "./ModelHttpErrors.js";
import { ModelResponseLimitError } from "./ModelHttpErrors.js";
import { parseModelHttpJsonObject } from "./ModelHttpJson.js";
import { fetchModelHttpWithRetries } from "./ModelHttpRetry.js";
import { createModelHttpUrl } from "./ModelHttpUrl.js";
import { parseModelEventStreamText } from "./ModelSseStreamParser.js";
import type { ModelSseEventProjection } from "./ModelSseStreamParser.js";
import { mergeProviderReportedUsage, type AgentModelUsageValue } from "./AgentModelUsage.js";
import { resolveAgentModelResponseBudget } from "./ModelResponseBudget.js";

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
    const budget = resolveAgentModelResponseBudget(this.config);
    const lifetime = createModelRequestLifetime(this.config, options.signal);
    try {
      const response = await this.fetchWithRetries(path, {
        method: "POST",
        headers: this.headers(headers),
        body: JSON.stringify(payload),
        signal: lifetime.signal,
      });
      return parseModelHttpJsonObject(await readJsonBody(response, budget.maxResponseBytes));
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
    projectEvent: (event: JsonObject) => ModelSseEventProjection,
    query?: Record<string, string>,
    options: { signal?: AbortSignal } = {},
  ): Promise<AgentLanguageModelStream> {
    const budget = resolveAgentModelResponseBudget(this.config);
    const controller = new AbortController();
    const requestSignal = options.signal ? combineAbortSignals(options.signal, controller.signal) : controller.signal;
    const lifetime = createModelRequestLifetime(this.config, requestSignal);
    const dispose = (): void => {
      lifetime.dispose();
      disposeCombinedAbortSignal(requestSignal);
    };
    const response = await this.openSseResponse(path, payload, headers, query, lifetime.signal).catch((error) => {
      dispose();
      throw error;
    });

    let usage: AgentModelUsageValue | undefined;
    const chunks = parseModelEventStreamText(response.body, projectEvent, {
      requestSignal: lifetime.signal,
      firstTokenTimeoutMs: this.config.FirstTokenTimeoutMs,
      dispose,
      normalizeError: (error) => this.normalizeError(error),
      onUsage: (value) => {
        usage = mergeProviderReportedUsage(usage, value);
      },
      maxResponseBytes: budget.maxResponseBytes,
      maxEventBytes: budget.maxSseEventBytes,
      maxEvents: budget.maxSseEvents,
    });
    return {
      metadata: this.metadata,
      get usage() {
        return usage;
      },
      abort: () => {
        controller.abort();
        dispose();
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
      const response = await this.fetchWithRetries(
        path,
        {
          method: "POST",
          headers: {
            ...this.headers(headers),
            Accept: "text/event-stream",
          },
          body: JSON.stringify(payload),
          signal,
        },
        query,
      );
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
    return fetchModelHttpWithRetries(this.config, createModelHttpUrl(this.config, path, query), init);
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

async function readJsonBody(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.body) throw new Error(agentErrorMessage("model.readableStreamMissing"));
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) throw new ModelResponseLimitError("response", maxBytes);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder().decode(concatBytes(chunks)));
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
