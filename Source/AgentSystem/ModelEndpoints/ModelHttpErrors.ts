import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";

export class ModelProviderHttpError extends AgentBaseError {
  constructor(
    readonly status: number,
    statusText: string,
    readonly detail: string,
  ) {
    super(`${status} ${statusText} ${detail}`);
  }
}

export class ModelRequestTimeoutError extends AgentBaseError {
  constructor(readonly kind: "request_header" | "max_request" | "first_token") {
    super(kind);
  }
}

/** Finds a provider deadline even when an adapter has wrapped the original error. */
export function findModelRequestTimeoutError(error: unknown): ModelRequestTimeoutError | undefined {
  return errorChain(error).find(
    (entry): entry is ModelRequestTimeoutError => entry instanceof ModelRequestTimeoutError,
  );
}

export function normalizeModelHttpError(config: ResolvedAgentModelProviderConfig, error: unknown): Error {
  if (error instanceof ModelProviderHttpError) {
    return new AgentLocalizedError(
      "model.requestFailedWithStatus",
      {
        status: error.status,
        model: config.Model,
        endpoint: config.Endpoint,
        baseUrl: config.BaseUrl,
        detail: error.detail,
      },
      { cause: error },
    );
  }

  const timeoutError = findModelRequestTimeoutError(error);
  if (timeoutError) {
    return new AgentLocalizedError(
      "model.requestTimeout",
      {
        kind: timeoutError.kind,
        model: config.Model,
        endpoint: config.Endpoint,
        baseUrl: config.BaseUrl,
      },
      { cause: timeoutError },
    );
  }

  if (error instanceof Error) {
    return new AgentLocalizedError(
      "model.requestFailed",
      {
        model: config.Model,
        endpoint: config.Endpoint,
        baseUrl: config.BaseUrl,
        detail: error.message,
      },
      { cause: error },
    );
  }

  return new AgentLocalizedError(
    "model.requestFailed",
    {
      model: config.Model,
      endpoint: config.Endpoint,
      baseUrl: config.BaseUrl,
      detail: String(error),
    },
    { cause: error },
  );
}

function errorChain(error: unknown): Error[] {
  const chain: Error[] = [];
  const seen = new Set<object>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) chain.push(current);
    current = Reflect.get(current, "cause") ?? Reflect.get(current, "originalError");
  }
  return chain;
}
