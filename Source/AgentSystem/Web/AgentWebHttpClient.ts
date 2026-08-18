import chardet from "chardet";
import iconv from "iconv-lite";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import { assertSafeWebUrl, type AgentWebAddressResolver, type AgentWebUrlPolicyOptions } from "./AgentWebUrlPolicy.js";
import type { AgentWebFetchTransfer } from "./AgentWebTypes.js";

export interface AgentWebHttpClientOptions extends AgentWebUrlPolicyOptions {
  readonly maxRedirects: number;
  readonly responseMaxBytes: number;
  readonly userAgent: string;
  /** A single deadline for the complete request, including redirects and body reading. */
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly resolveHostAddresses?: AgentWebAddressResolver;
}

export interface AgentWebHttpRequestOptions {
  readonly method?: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
}

export interface AgentWebHttpResponse {
  readonly url: string;
  readonly status: number;
  readonly statusText: string;
  readonly contentType: string;
  readonly body: Uint8Array;
  readonly transfer: AgentWebFetchTransfer;
}

export class AgentWebHttpError extends AgentBaseError {
  constructor(
    readonly code: "request_failed" | "http_error" | "redirect_limit" | "timeout",
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export async function fetchWebResource(
  inputUrl: string,
  options: AgentWebHttpClientOptions,
  signal?: AbortSignal,
): Promise<AgentWebHttpResponse> {
  return requestWebResource(inputUrl, options, {}, signal);
}

export async function requestWebResource(
  inputUrl: string,
  options: AgentWebHttpClientOptions,
  request: AgentWebHttpRequestOptions = {},
  signal?: AbortSignal,
): Promise<AgentWebHttpResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const requestControl = createRequestControl(signal, options.timeoutMs);
  let current: string | URL = inputUrl;
  let redirectCount = 0;
  let method = request.method ?? "GET";
  let requestBody = request.body;

  try {
    if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
    current = await waitForAbort(
      assertSafeWebUrl(inputUrl, options, options.resolveHostAddresses),
      requestControl.signal,
    );
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
      let response: Response;
      try {
        response = await fetchImpl(current, {
          method,
          redirect: "manual",
          headers: {
            Accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.1",
            "User-Agent": options.userAgent,
            ...request.headers,
          },
          ...(requestBody === undefined
            ? {}
            : { body: typeof requestBody === "string" ? requestBody : Buffer.from(requestBody) }),
          signal: requestControl.signal,
        });
      } catch (error) {
        if (signal?.aborted || requestControl.timedOut) throw error;
        throw new AgentWebHttpError(
          "request_failed",
          `Web request failed for ${current.toString()}.`,
          { url: current.toString() },
          { cause: error },
        );
      }

      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          throw new AgentWebHttpError(
            "http_error",
            `Web server returned redirect ${response.status} without a location.`,
            {
              url: current.toString(),
              status: response.status,
            },
          );
        }
        if (redirectCount >= options.maxRedirects) {
          throw new AgentWebHttpError("redirect_limit", "Web request exceeded the configured redirect limit.", {
            maxRedirects: options.maxRedirects,
          });
        }
        current = await waitForAbort(
          assertSafeWebUrl(new URL(location, current), options, options.resolveHostAddresses),
          requestControl.signal,
        );
        if (response.status === 301 || response.status === 302 || response.status === 303) {
          method = "GET";
          requestBody = undefined;
        }
        redirectCount += 1;
        continue;
      }

      const responseBody = await readBoundedBody(response, options.responseMaxBytes, requestControl.signal);
      if (!response.ok) {
        throw new AgentWebHttpError("http_error", `Web server returned HTTP ${response.status}.`, {
          url: current.toString(),
          status: response.status,
          statusText: response.statusText,
          bodyPreview: decodeWebBody(responseBody.body, response.headers.get("content-type") ?? "", 2_000),
        });
      }
      return {
        url: current.toString(),
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get("content-type") ?? "",
        body: responseBody.body,
        transfer: responseBody.transfer,
      };
    }
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    if (requestControl.timedOut) {
      throw new AgentWebHttpError(
        "timeout",
        `Web request exceeded the configured timeout of ${requestControl.timeoutMs} ms.`,
        { url: current.toString(), timeoutMs: requestControl.timeoutMs },
        { cause: error },
      );
    }
    throw error;
  } finally {
    requestControl.dispose();
  }
}

function createRequestControl(signal: AbortSignal | undefined, timeoutMs: number | undefined): RequestControl {
  const controller = new AbortController();
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () =>
    controller.abort(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));

  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  const normalizedTimeout = normalizeTimeout(timeoutMs);
  if (normalizedTimeout !== undefined) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("The web request timed out.", "TimeoutError"));
    }, normalizedTimeout);
  }

  return {
    signal: controller.signal,
    timeoutMs: normalizedTimeout ?? 0,
    get timedOut() {
      return timedOut;
    },
    dispose() {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

interface RequestControl {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly timedOut: boolean;
  dispose(): void;
}

function normalizeTimeout(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

async function waitForAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function decodeWebBody(body: Uint8Array, contentType: string, maxChars?: number): string {
  const charset = /(?:^|;)\s*charset\s*=\s*["']?([^;"']+)/iu.exec(contentType)?.[1]?.trim();
  const detected = charset || chardet.detect(body) || "utf-8";
  const decoded = iconv.encodingExists(detected)
    ? iconv.decode(Buffer.from(body), detected)
    : new TextDecoder("utf-8", { fatal: false }).decode(body);
  return maxChars === undefined ? decoded : Array.from(decoded).slice(0, maxChars).join("");
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<{ readonly body: Uint8Array; readonly transfer: AgentWebFetchTransfer }> {
  const declaredContentLength = parseContentLength(response.headers.get("content-length"));
  if (!response.body) {
    const body = new Uint8Array(await response.arrayBuffer());
    const retained = body.subarray(0, maxBytes);
    return {
      body: retained,
      transfer: {
        maxBytes,
        receivedBytes: retained.byteLength,
        ...(declaredContentLength === undefined ? {} : { declaredContentLength }),
        truncated: body.byteLength > maxBytes,
      },
    };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
      const next = await reader.read();
      if (next.done) break;
      const remaining = maxBytes - total;
      if (remaining <= 0) {
        truncated = true;
        await reader.cancel("response limit exceeded").catch(() => undefined);
        break;
      }
      if (next.value.byteLength <= remaining) {
        chunks.push(next.value);
        total += next.value.byteLength;
        continue;
      }
      chunks.push(next.value.subarray(0, remaining));
      total += remaining;
      truncated = true;
      await reader.cancel("response limit exceeded").catch(() => undefined);
      break;
    }
  } finally {
    reader.releaseLock();
  }
  return {
    body: concatBytes(chunks, total),
    transfer: {
      maxBytes,
      receivedBytes: total,
      ...(declaredContentLength === undefined ? {} : { declaredContentLength }),
      truncated,
    },
  };
}

function parseContentLength(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function concatBytes(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
