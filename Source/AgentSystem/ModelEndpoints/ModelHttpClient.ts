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
    const lifetime = this.createRequestLifetime();
    try {
      const response = await this.fetchWithRetries(this.url(path), {
        method: "POST",
        headers: this.headers(headers),
        body: JSON.stringify(payload),
        signal: lifetime.signal,
      });
      return JsonObjectSchema.parse(await response.json());
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
  ): Promise<AgentLanguageModelStream> {
    const controller = new AbortController();
    const lifetime = this.createRequestLifetime(controller.signal);
    let response: Response;
    try {
      response = await this.fetchWithRetries(this.url(path, query), {
        method: "POST",
        headers: {
          ...this.headers(headers),
          Accept: "text/event-stream",
        },
        body: JSON.stringify(payload),
        signal: lifetime.signal,
      });
    } catch (error) {
      lifetime.dispose();
      throw this.normalizeError(error);
    }

    if (!response.body) {
      lifetime.dispose();
      throw this.normalizeError(new Error("模型服务没有返回可读取的流。"));
    }

    const chunks = parseEventStreamText(response.body, extractText, {
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

  private async fetchWithRetries(url: URL, init: RequestInit): Promise<Response> {
    let lastError: unknown;
    const attempts = this.config.MaxNetworkRetries + 1;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const timeout = new AbortController();
      const signal = combineAbortSignals(init.signal, timeout.signal);
      const timer = setTimeout(() => timeout.abort(new ModelRequestTimeoutError("request_header")), this.config.TimeoutMs);

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
        const abortFailure = readAbortFailure(init.signal, timeout.signal, signal);
        if (init.signal?.aborted || attempt === attempts - 1 || !isRetryableFetchError(error)) {
          throw abortFailure?.reason ?? error;
        }
        lastError = abortFailure?.reason ?? error;
      }
    }

    throw lastError;
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

    if (error instanceof ModelRequestTimeoutError) {
      return new Error(
        `模型请求超时。 kind=${error.kind} model=${this.config.Model} endpoint=${this.config.Endpoint} baseUrl=${this.config.BaseUrl}`,
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

  private createRequestLifetime(parent?: AbortSignal): {
    signal: AbortSignal;
    dispose: () => void;
  } {
    if (this.config.MaxRequestMs === -1) {
      return parent
        ? {
            signal: parent,
            dispose: () => undefined,
          }
        : {
            signal: new AbortController().signal,
            dispose: () => undefined,
          };
    }

    const timeout = new AbortController();
    const signal = combineAbortSignals(parent, timeout.signal);
    const timer = setTimeout(() => timeout.abort(new ModelRequestTimeoutError("max_request")), this.config.MaxRequestMs);
    return {
      signal,
      dispose: () => clearTimeout(timer),
    };
  }
}

export function rawPathSegment(value: string): ModelHttpPathSegment {
  return { value, encode: "path" };
}

async function* parseEventStreamText(
  body: ReadableStream<Uint8Array>,
  extractText: (event: JsonObject) => string,
  options: {
    requestSignal: AbortSignal;
    firstTokenTimeoutMs: number;
    dispose: () => void;
    normalizeError: (error: unknown) => Error;
  },
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
  let firstTokenSeen = false;
  const firstTokenController = new AbortController();
  const firstTokenTimer = options.firstTokenTimeoutMs === -1
    ? undefined
    : setTimeout(
        () => firstTokenController.abort(new ModelRequestTimeoutError("first_token")),
        options.firstTokenTimeoutMs,
      );

  try {
    while (true) {
      const { value, done } = await readStreamChunk(
        reader,
        options.requestSignal,
        firstTokenSeen || options.firstTokenTimeoutMs === -1 ? undefined : firstTokenController.signal,
      );
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
        if (!firstTokenSeen) {
          firstTokenSeen = true;
          if (firstTokenTimer) clearTimeout(firstTokenTimer);
        }
        accumulatedText += textDelta;
        yield {
          textDelta,
          accumulatedText,
        };
      }

      if (done) break;
    }
  } catch (error) {
    throw options.normalizeError(error);
  } finally {
    if (firstTokenTimer) clearTimeout(firstTokenTimer);
    options.dispose();
    reader.releaseLock();
  }
}

function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  requestSignal: AbortSignal,
  firstTokenSignal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  const abortFailure = readAbortFailure(firstTokenSignal, requestSignal);
  if (abortFailure) {
    return Promise.reject(abortFailure.reason);
  }

  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(readAbortFailure(firstTokenSignal, requestSignal)?.reason);
    requestSignal.addEventListener("abort", onAbort, { once: true });
    firstTokenSignal?.addEventListener("abort", onAbort, { once: true });
    reader.read().then(resolve, reject).finally(() => {
      requestSignal.removeEventListener("abort", onAbort);
      firstTokenSignal?.removeEventListener("abort", onAbort);
    });
  });
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

class ModelRequestTimeoutError extends Error {
  constructor(readonly kind: "request_header" | "max_request" | "first_token") {
    super(kind);
    this.name = "ModelRequestTimeoutError";
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

function readAbortFailure(...signals: Array<AbortSignal | null | undefined>): { reason: unknown } | undefined {
  const signal = signals.find((item) => item?.aborted);
  return signal
    ? { reason: signal.reason ?? new Error("请求已取消。") }
    : undefined;
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
  const abort = (event?: Event): void => {
    const source = event?.target as AbortSignal | undefined;
    controller.abort(source?.reason);
  };
  if (first.aborted || second.aborted) {
    controller.abort(first.reason ?? second.reason);
    return controller.signal;
  }

  first.addEventListener("abort", abort, { once: true });
  second.addEventListener("abort", abort, { once: true });
  return controller.signal;
}
