import type { ModelProviderConfig } from "./ModelEndpointTypes.js";
import { combineAbortSignals, readAbortFailure } from "./ModelHttpAbort.js";
import {
  ModelProviderHttpError,
  ModelRequestTimeoutError,
  safeReadResponseBody,
} from "./ModelHttpErrors.js";

export async function fetchModelHttpWithRetries(
  config: ModelProviderConfig,
  url: URL,
  init: RequestInit,
): Promise<Response> {
  let lastError: unknown;
  const attempts = config.MaxNetworkRetries + 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const timeout = new AbortController();
    const signal = combineAbortSignals(init.signal, timeout.signal);
    const timer = setTimeout(
      () => timeout.abort(new ModelRequestTimeoutError("request_header")),
      config.TimeoutMs,
    );

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

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isRetryableFetchError(error: unknown): boolean {
  return !(error instanceof ModelProviderHttpError);
}
