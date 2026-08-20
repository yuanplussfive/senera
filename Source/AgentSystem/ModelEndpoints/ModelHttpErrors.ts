import type { ModelProviderConfig } from "./ModelEndpointTypes.js";
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

export class ModelResponseLimitError extends AgentBaseError {
  constructor(
    readonly kind: "response" | "SSE response" | "SSE event" | "SSE events",
    readonly limit: number,
  ) {
    super(
      kind === "SSE events"
        ? `Model SSE stream exceeded the configured ${limit}-event budget.`
        : `Model ${kind} exceeded the configured ${limit}-byte budget.`,
    );
  }
}

export function normalizeModelHttpError(config: ModelProviderConfig, error: unknown): Error {
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

  if (error instanceof ModelRequestTimeoutError) {
    return new AgentLocalizedError(
      "model.requestTimeout",
      {
        kind: error.kind,
        model: config.Model,
        endpoint: config.Endpoint,
        baseUrl: config.BaseUrl,
      },
      { cause: error },
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

export async function safeReadResponseBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
