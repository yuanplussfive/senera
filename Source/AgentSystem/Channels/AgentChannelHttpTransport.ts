import { throwAbortReason } from "../Core/AgentCancellation.js";

/**
 * Minimal HTTP wrapper used by channel adapters. Real adapters rely on the
 * global fetch implementation; tests inject a fake transport so no external
 * network is required and failure paths are deterministic.
 */

export interface AgentChannelHttpRequestOptions {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly headers?: Readonly<Record<string, string>>;
  /** JSON strings or raw bytes for pre-signed media uploads. */
  readonly body?: string | Uint8Array;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface AgentChannelHttpResponse {
  readonly status: number;
  readonly body: unknown;
  readonly reason?: string;
  /** Raw response bytes when the endpoint returns binary content. */
  readonly bytes?: Uint8Array;
  /** Response media type, useful when a binary endpoint omits a filename. */
  readonly contentType?: string;
}

export interface AgentChannelHttpTransport {
  request(url: string, options?: AgentChannelHttpRequestOptions): Promise<AgentChannelHttpResponse>;
}

export interface AgentChannelHttpStatusError {
  readonly status: number;
  readonly body: unknown;
}

export function isAgentChannelHttpStatusError(error: unknown, status: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { status?: unknown }).status === status &&
    (error as { reason?: unknown }).reason !== undefined
  );
}

export class AgentChannelHttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentChannelHttpError";
    this.status = status;
    this.body = body;
  }
}

const DefaultTimeoutMs = 30_000;

export class AgentChannelFetchTransport implements AgentChannelHttpTransport {
  async request(url: string, options?: AgentChannelHttpRequestOptions): Promise<AgentChannelHttpResponse> {
    const timeoutMs = options?.timeoutMs ?? DefaultTimeoutMs;
    throwAbortReason(options?.signal);
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = options?.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
    try {
      const response = await fetch(url, {
        method: options?.method ?? "GET",
        headers: options?.headers,
        // `fetch`'s DOM typings do not include the Node `Uint8Array` body
        // shape, although undici accepts it at runtime for binary uploads.
        body: options?.body as BodyInit | undefined,
        signal,
      });
      const contentType = response.headers.get("content-type") ?? undefined;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const body = parseResponseBody(bytes, contentType);
      if (!response.ok) {
        throw new AgentChannelHttpError(
          `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
          response.status,
          body,
        );
      }
      return { status: response.status, body, reason: response.statusText, bytes, contentType };
    } catch (error) {
      throwAbortReason(options?.signal);
      if (timeoutSignal.aborted) {
        throw new AgentChannelHttpError(`Request timed out after ${timeoutMs}ms.`, 0, undefined, { cause: error });
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new AgentChannelHttpError("Request aborted.", 0, undefined, { cause: error });
      }
      throw error;
    }
  }
}

function parseResponseBody(bytes: Uint8Array, contentType?: string): unknown {
  if (bytes.byteLength === 0) return undefined;
  const text = new TextDecoder().decode(bytes);
  if (!text) return undefined;
  if (contentType?.toLowerCase().includes("json")) return parseJsonLoose(text);
  // A few QQ endpoints omit content-type while returning JSON. Preserve the
  // old loose parsing behavior without turning arbitrary media into text.
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return parseJsonLoose(text);
  return bytes;
}

function parseJsonLoose(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
