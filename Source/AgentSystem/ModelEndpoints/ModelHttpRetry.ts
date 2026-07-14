import type { ModelProviderConfig } from "./ModelEndpointTypes.js";
import { combineAbortSignals, readAbortFailure } from "./ModelHttpAbort.js";
import { ModelProviderHttpError, ModelRequestTimeoutError, safeReadResponseBody } from "./ModelHttpErrors.js";

export interface ModelHttpRetryOptions {
  random?: () => number;
  now?: () => number;
  sleep?: (delayMs: number, signal?: AbortSignal | null) => Promise<void>;
}

export async function fetchModelHttpWithRetries(
  config: ModelProviderConfig,
  url: URL,
  init: RequestInit,
  options: ModelHttpRetryOptions = {},
): Promise<Response> {
  let lastError: unknown;
  const attempts = config.MaxNetworkRetries + 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let retryAfterMs: number | undefined;
    const timeout = new AbortController();
    const signal = combineAbortSignals(init.signal, timeout.signal);
    const timer = setTimeout(() => timeout.abort(new ModelRequestTimeoutError("request_header")), config.TimeoutMs);

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
      retryAfterMs = parseRetryAfterMs(
        response.headers.get("retry-after"),
        options.now?.() ?? Date.now(),
        config.RetryAfterMaxDelayMs,
      );
    } catch (error) {
      clearTimeout(timer);
      const abortFailure = readAbortFailure(init.signal, timeout.signal, signal);
      if (init.signal?.aborted || attempt === attempts - 1 || !isRetryableFetchError(error)) {
        throw abortFailure?.reason ?? error;
      }
      lastError = abortFailure?.reason ?? error;
    }

    const delayMs =
      retryAfterMs ??
      exponentialBackoffMs(
        attempt,
        options.random?.() ?? Math.random(),
        config.RetryBaseDelayMs,
        config.RetryMaxDelayMs,
      );
    await (options.sleep ?? waitForRetry)(delayMs, init.signal);
  }

  throw lastError;
}

export function parseRetryAfterMs(value: string | null, nowMs: number, maxDelayMs: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(maxDelayMs, Math.ceil(seconds * 1_000));
  }
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.min(maxDelayMs, Math.max(0, dateMs - nowMs)) : undefined;
}

function exponentialBackoffMs(attempt: number, random: number, baseDelayMs: number, maxDelayMs: number): number {
  const boundedRandom = Math.max(0, Math.min(1, random));
  const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.round(delay * (0.5 + boundedRandom));
}

function waitForRetry(delayMs: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("请求已取消。"));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      cleanup();
      reject(signal?.reason ?? new Error("请求已取消。"));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isRetryableFetchError(error: unknown): boolean {
  return !(error instanceof ModelProviderHttpError);
}
