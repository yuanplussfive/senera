import { createParser } from "eventsource-parser";
import type {
  JsonObject,
  ModelHttpPathSegment,
  ModelProviderConfig,
} from "./ModelEndpointTypes.js";
import type {
  AgentLanguageModelStream,
  AgentLanguageModelStreamChunk,
} from "../AgentLanguageModel.js";
import type { AgentModelProviderMetadata } from "../AgentModelMetadata.js";
import { z } from "zod";

const JsonObjectSchema = z.record(z.string(), z.unknown());

export class ModelHttpClient {
  constructor(
    private readonly config: ModelProviderConfig,
    private readonly metadata: AgentModelProviderMetadata,
  ) {}

  async postJson(path: ModelHttpPathSegment[], payload: unknown, headers: HeadersInit): Promise<JsonObject> {
    const response = await this.fetchWithRetries(this.url(path), {
      method: "POST",
      headers: this.headers(headers),
      body: JSON.stringify(payload),
    });
    return JsonObjectSchema.parse(await response.json());
  }

  async postSseStream(
    path: ModelHttpPathSegment[],
    payload: unknown,
    headers: HeadersInit,
    extractText: (event: JsonObject) => string,
    query?: Record<string, string>,
  ): Promise<AgentLanguageModelStream> {
    const controller = new AbortController();
    const response = await this.fetchWithRetries(this.url(path, query), {
      method: "POST",
      headers: {
        ...this.headers(headers),
        Accept: "text/event-stream",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.body) {
      throw new Error("模型服务没有返回可读取的流。");
    }

    const chunks = parseEventStreamText(response.body, extractText);
    return {
      metadata: this.metadata,
      abort: () => controller.abort(),
      [Symbol.asyncIterator]: () => chunks,
    };
  }

  private async fetchWithRetries(url: URL, init: RequestInit): Promise<Response> {
    let lastError: unknown;
    const attempts = this.config.MaxNetworkRetries + 1;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const timeout = new AbortController();
      const signal = combineAbortSignals(init.signal, timeout.signal);
      const timer = setTimeout(() => timeout.abort(), this.config.TimeoutMs);

      try {
        const response = await fetch(url, {
          ...init,
          signal,
        });
        clearTimeout(timer);

        if (response.ok) {
          return response;
        }

        const body = await safeReadResponseBody(response);
        const error = new ModelProviderHttpError(response.status, response.statusText, body);
        if (!isRetryableStatus(response.status) || attempt === attempts - 1) {
          throw error;
        }
        lastError = error;
      } catch (error) {
        clearTimeout(timer);
        if (init.signal?.aborted || attempt === attempts - 1 || !isRetryableFetchError(error)) {
          throw this.normalizeError(error);
        }
        lastError = error;
      }
    }

    throw this.normalizeError(lastError);
  }

  private headers(headers: HeadersInit): HeadersInit {
    return {
      "content-type": "application/json",
      ...headers,
    };
  }

  private url(path: ModelHttpPathSegment[], query?: Record<string, string>): URL {
    const url = new URL(withTrailingSlash(this.config.BaseUrl));
    const baseSegments = url.pathname.split("/").filter(Boolean);
    url.pathname = [...baseSegments, ...path.map(formatPathSegment)].join("/");
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    return url;
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof ModelProviderHttpError) {
      return new Error(
        `模型请求失败。 status=${error.status} model=${this.config.Model} endpoint=${this.config.Endpoint} baseUrl=${this.config.BaseUrl} detail=${error.detail}`,
        { cause: error },
      );
    }

    if (error instanceof Error) {
      return new Error(
        `模型请求失败。 model=${this.config.Model} endpoint=${this.config.Endpoint} baseUrl=${this.config.BaseUrl} detail=${error.message}`,
        { cause: error },
      );
    }

    return new Error(
      `模型请求失败。 model=${this.config.Model} endpoint=${this.config.Endpoint} baseUrl=${this.config.BaseUrl} detail=${String(error)}`,
      { cause: error },
    );
  }
}

export function rawPathSegment(value: string): ModelHttpPathSegment {
  return { value, encode: "path" };
}

async function* parseEventStreamText(
  body: ReadableStream<Uint8Array>,
  extractText: (event: JsonObject) => string,
): AsyncGenerator<AgentLanguageModelStreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events: JsonObject[] = [];
  const parser = createParser({
    onEvent: (event) => {
      if (event.data === "[DONE]") return;
      events.push(JsonObjectSchema.parse(JSON.parse(event.data) as unknown));
    },
    onError: (error) => {
      throw error;
    },
  });
  let accumulatedText = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) {
        parser.feed(decoder.decode(value, { stream: !done }));
      }
      if (done) {
        parser.reset({ consume: true });
      }

      while (events.length > 0) {
        const event = events.shift();
        if (!event) continue;
        const textDelta = extractText(event);
        if (!textDelta) continue;
        accumulatedText += textDelta;
        yield {
          textDelta,
          accumulatedText,
        };
      }

      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

class ModelProviderHttpError extends Error {
  constructor(
    readonly status: number,
    statusText: string,
    readonly detail: string,
  ) {
    super(`${status} ${statusText} ${detail}`);
  }
}

async function safeReadResponseBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isRetryableFetchError(error: unknown): boolean {
  return !(error instanceof ModelProviderHttpError);
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function formatPathSegment(segment: ModelHttpPathSegment): string {
  if (typeof segment === "string") {
    return encodeURIComponent(segment);
  }

  return segment.encode === "path"
    ? encodeURI(segment.value)
    : encodeURIComponent(segment.value);
}

function combineAbortSignals(first: AbortSignal | null | undefined, second: AbortSignal): AbortSignal {
  if (!first) return second;

  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (first.aborted || second.aborted) {
    abort();
    return controller.signal;
  }

  first.addEventListener("abort", abort, { once: true });
  second.addEventListener("abort", abort, { once: true });
  return controller.signal;
}
