import { errorMessage } from "./AgentErrors.js";

/**
 * Context label injected into error messages to identify which JSON source
 * failed to parse. Example: `"Authentication request body"`,
 * `"OCI archive metadata"`.
 */
export type JsonParseContextLabel = string;

/**
 * Parses a JSON string, throwing a contextual `Error` on failure.
 *
 * The `contextLabel` is embedded in the error message so callers can identify
 * which payload failed (e.g. `"Authentication request body"`,
 * `"OCI archive metadata: manifest.json"`). When omitted the message uses a
 * generic prefix.
 *
 * This is the canonical replacement for the 7+ local `readJsonBody` /
 * `parseJson` / `readJson` copies previously spread across Auth, PiProxy,
 * ModelEndpoints, Sandbox, and ToolSearch.
 */
export function parseJsonText(text: string, contextLabel?: JsonParseContextLabel): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const prefix = contextLabel ? `${contextLabel} is not valid JSON` : "JSON parsing failed";
    throw new Error(`${prefix}: ${errorMessage(error)}`, { cause: error });
  }
}

/**
 * Parses a JSON string, returning `undefined` on failure instead of throwing.
 *
 * Use this in code paths where malformed JSON should be silently ignored
 * (e.g. best-effort extraction of optional metadata). For all error-reporting
 * paths, prefer {@link parseJsonText}.
 */
export function parseJsonTextOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Options for {@link readStreamJsonBody}.
 */
export interface ReadStreamJsonBodyOptions {
  /** Maximum number of bytes to read before throwing. */
  readonly maximumBytes: number;
  /** Context label embedded in error messages. */
  readonly contextLabel: JsonParseContextLabel;
  /**
   * Called when the byte limit is exceeded. The thrown error from this
   * callback propagates to the caller, allowing domain-specific error types
   * (e.g. `PiProxyRequestTooLargeError`).
   */
  readonly onTooLarge?: () => Error;
}

/**
 * Reads an HTTP request body (Node.js `IncomingMessage` / any `Readable`
 * stream) as a UTF-8 string, then parses it as JSON.
 *
 * - Empty or whitespace-only bodies return `{}`.
 * - Bytes exceeding `maximumBytes` trigger `onTooLarge` (or a generic
 *   `Error` if not provided).
 * - JSON parse failures throw a contextual `Error` via {@link parseJsonText}.
 *
 * Replaces the near-identical copies in `AgentAuthenticationHttpApi` and
 * `AgentPiProxyHttpApi`.
 */
export async function readStreamJsonBody(
  stream: AsyncIterable<Buffer | Uint8Array | string>,
  options: ReadStreamJsonBodyOptions,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.length;
    if (receivedBytes > options.maximumBytes) {
      throw options.onTooLarge?.() ?? new Error(`${options.contextLabel} exceeds ${options.maximumBytes} bytes`);
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return parseJsonText(text, options.contextLabel);
}
