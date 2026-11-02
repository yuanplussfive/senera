import chardet from "chardet";
import iconv from "iconv-lite";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import { assertSafeWebUrl, type AgentWebAddressResolver, type AgentWebUrlPolicyOptions } from "./AgentWebUrlPolicy.js";
import type { AgentWebFetchTransfer } from "./AgentWebTypes.js";
import { isAgentWebRedirect, projectAgentWebRedirectHeaders } from "./AgentWebRedirectPolicy.js";
import { readBoundedWebBody } from "./AgentWebResponseBody.js";

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
  let headers = request.headers;
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
            ...headers,
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

      if (isAgentWebRedirect(response.status)) {
        await response.body?.cancel();
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
        const target: URL = await waitForAbort(
          assertSafeWebUrl(new URL(location, current), options, options.resolveHostAddresses),
          requestControl.signal,
        );
        const dropBody = response.status === 301 || response.status === 302 || response.status === 303;
        const source = new URL(current);
        if (!dropBody && requestBody !== undefined && source.origin !== target.origin) {
          throw new AgentWebHttpError("request_failed", "A cross-origin redirect cannot replay a request body.", {
            url: current.toString(),
            status: response.status,
          });
        }
        headers = projectAgentWebRedirectHeaders(headers, source, target, dropBody);
        current = target;
        if (dropBody) {
          method = "GET";
          requestBody = undefined;
        }
        redirectCount += 1;
        continue;
      }

      const responseBody = await readBoundedWebBody(response, options.responseMaxBytes, requestControl.signal);
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
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError("Web request timeoutMs must be a positive safe integer.");
  }
  return value;
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
