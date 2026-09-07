import { randomUUID } from "node:crypto";
import path from "node:path";
import { lookup as lookupMimeType } from "mime-types";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { sha256Hex } from "../Core/AgentHash.js";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentToolArtifactAsset, AgentToolArtifactPayload } from "../Types/ToolRuntimeTypes.js";
import { AgentExecutionErrorCodes } from "../Xml/AgentXmlStatus.js";
import { createAgentResourceId, createAgentResourceUri } from "../Resources/AgentResourceUri.js";
import { assertSafeWebUrl, type AgentWebAddressResolver } from "../Web/AgentWebUrlPolicy.js";
import { matchesAgentBrowserDomain, type AgentBrowserConfiguration } from "./AgentBrowserConfiguration.js";
import type {
  AgentBrowserDriver,
  AgentBrowserDriverDownload,
  AgentBrowserDriverOperationResult,
  AgentBrowserDriverSession,
  AgentBrowserNetworkRequestKind,
} from "./AgentBrowserDriver.js";
import { AgentBrowserExecutableResolutionError } from "./AgentBrowserExecutableResolver.js";
import { AgentPlaywrightBrowserDriver } from "./AgentPlaywrightBrowserDriver.js";
import type {
  AgentBrowserOperation,
  AgentBrowserOperationExecution,
  AgentBrowserOperationResult,
} from "./AgentBrowserTypes.js";

const BrowserContentTrust = "untrusted_browser_content" as const;

const PublicArgumentsByOperation = {
  open: ["url"],
  read: ["url"],
  snapshot: ["selector", "interactive", "compact", "includeUrls", "depth"],
  click: ["selector", "newTab"],
  fill: ["selector", "text"],
  type: ["selector", "text", "clear", "delayMs"],
  press: ["keys"],
  check: ["selector"],
  uncheck: ["selector"],
  select: ["selector", "values"],
  scroll: ["direction", "amount", "selector"],
  wait_ms: ["ms"],
  wait_for_selector: ["selector", "waitTimeoutMs"],
  wait_for_text: ["text", "waitTimeoutMs"],
  wait_for_load: ["state", "waitTimeoutMs"],
  screenshot: ["fullPage", "selector", "annotate", "format"],
  get_text: ["selector"],
  get_url: [],
  get_title: [],
  close: [],
  back: [],
  forward: [],
  reload: [],
  tab_new: ["url", "label"],
  tab_list: [],
  tab_switch: ["tab"],
  tab_close: ["tab"],
  download: ["selector"],
  computer: ["actions"],
} as const satisfies Record<AgentBrowserOperation, readonly string[]>;

const OperationSummary = {
  open: "Opened a controlled browser page.",
  read: "Read browser content.",
  snapshot: "Captured an accessibility snapshot.",
  click: "Activated a browser element.",
  fill: "Filled a browser input.",
  type: "Typed into a browser element.",
  press: "Sent a browser key press.",
  check: "Checked a browser control.",
  uncheck: "Unchecked a browser control.",
  select: "Selected browser options.",
  scroll: "Scrolled browser content.",
  wait_ms: "Waited for browser activity.",
  wait_for_selector: "Waited for a browser element.",
  wait_for_text: "Waited for browser text.",
  wait_for_load: "Waited for the page load state.",
  screenshot: "Captured a browser screenshot.",
  get_text: "Read browser element text.",
  get_url: "Read the current browser URL.",
  get_title: "Read the current browser title.",
  close: "Closed the controlled browser session.",
  back: "Navigated browser history backward.",
  forward: "Navigated browser history forward.",
  reload: "Reloaded the browser page.",
  tab_new: "Opened a browser tab.",
  tab_list: "Listed browser tabs.",
  tab_switch: "Switched browser tabs.",
  tab_close: "Closed a browser tab.",
  download: "Downloaded a browser file.",
  computer: "Operated the browser visually.",
} as const satisfies Record<AgentBrowserOperation, string>;

interface AgentBrowserSessionState {
  readonly key: string;
  lastActivityAt: number;
  driverSession?: AgentBrowserDriverSession;
  opening?: Promise<AgentBrowserDriverSession>;
}

export interface AgentBrowserRuntimeOptions {
  readonly workspaceRoot: string;
  readonly configuration: AgentBrowserConfiguration;
  readonly driver?: AgentBrowserDriver;
  readonly resolveHostAddresses?: AgentWebAddressResolver;
  readonly resolveExecutable?: () => string;
}

export class AgentBrowserRuntimeError extends AgentBaseError {
  constructor(
    message: string,
    readonly code: (typeof AgentExecutionErrorCodes)[keyof typeof AgentExecutionErrorCodes] = AgentExecutionErrorCodes.ToolExecutionError,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * Maintains Senera-owned browser sessions. Page execution is delegated to a
 * Playwright driver; policy, approval boundaries, artifact publication, and
 * session ownership stay in the host runtime.
 */
export class AgentBrowserRuntime {
  readonly configuration: AgentBrowserConfiguration;
  private readonly driver: AgentBrowserDriver;
  private readonly sessions = new Map<string, AgentBrowserSessionState>();
  private readonly sessionQueues = new Map<string, Promise<void>>();
  private readonly workspaceRoot: string;
  private readonly shutdownController = new AbortController();
  private closed = false;
  private closePromise: Promise<void> | undefined;

  constructor(private readonly options: AgentBrowserRuntimeOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.configuration = options.configuration;
    this.driver =
      options.driver ??
      new AgentPlaywrightBrowserDriver({
        workspaceRoot: this.workspaceRoot,
        configuration: this.configuration,
        resolveExecutable: options.resolveExecutable,
      });
  }

  async execute(
    operation: AgentBrowserOperation,
    input: Readonly<Record<string, unknown>>,
    context: AgentHostToolContext,
  ): Promise<AgentBrowserOperationExecution> {
    if (this.closed) throw new AgentBrowserRuntimeError("The controlled browser runtime is closed.");
    const signal = composeBrowserSignals(context.signal, this.shutdownController.signal);
    assertNotAborted(signal);
    const executionContext = context.signal === signal ? context : { ...context, signal };
    const state = this.sessionFor(executionContext);
    await this.reclaimIdleSessions(state.key);

    return this.runInSession(state.key, signal, async () => {
      if (this.closed) throw new AgentBrowserRuntimeError("The controlled browser runtime is closed.");
      executionContext.reporter?.progress({ message: OperationSummary[operation] });
      const prepared = await this.prepareArguments(operation, input, signal);
      try {
        const raw =
          operation === "close" && !state.driverSession && !state.opening
            ? { content: "Controlled browser session closed." }
            : await (
                await this.driverSessionFor(state, signal)
              ).execute(operation, prepared.arguments, {
                timeoutMs: prepared.timeoutMs,
                signal,
              });
        const projection = this.projectResult(operation, raw, prepared.arguments);
        if (operation === "close") await this.disposeSession(state);
        state.lastActivityAt = Date.now();
        return { result: projection.result, artifactPayload: projection.artifactPayload };
      } catch (error) {
        state.lastActivityAt = Date.now();
        if (signal.aborted) {
          await this.disposeSession(state).catch(() => undefined);
          throw new AgentBrowserRuntimeError(
            errorMessage(signal.reason ?? error),
            AgentExecutionErrorCodes.ToolProcessCancelled,
            { cause: error },
          );
        }
        throw this.toRuntimeError(error);
      }
    });
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    if (!this.shutdownController.signal.aborted) {
      this.shutdownController.abort(
        new AgentBrowserRuntimeError(
          "The controlled browser runtime is shutting down.",
          AgentExecutionErrorCodes.ToolProcessCancelled,
        ),
      );
    }
    const closing = this.closeRuntime().finally(() => {
      if (this.closePromise === closing) this.closePromise = undefined;
    });
    this.closePromise = closing;
    return closing;
  }

  private async closeRuntime(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    const outcomes = await Promise.allSettled(sessions.map((session) => this.closeSession(session)));
    await Promise.allSettled(this.sessionQueues.values());
    const driverOutcome = await Promise.allSettled([this.driver.close()]);
    const failures = [...outcomes, ...driverOutcome]
      .filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected")
      .map((outcome) => outcome.reason);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Controlled browser runtime cleanup failed.");
  }

  private sessionFor(context: AgentHostToolContext): AgentBrowserSessionState {
    const sessionId = context.sessionId?.trim();
    if (!sessionId) {
      throw new AgentBrowserRuntimeError(
        "Controlled browser tools require a host session identity.",
        AgentExecutionErrorCodes.ToolProcessConfigurationInvalid,
      );
    }
    const key = sha256Hex(`senera-browser-session-v2\u0000${this.workspaceRoot}\u0000${sessionId}`);
    const current = this.sessions.get(key);
    if (current) return current;
    const state: AgentBrowserSessionState = {
      key,
      lastActivityAt: Date.now(),
    };
    this.sessions.set(key, state);
    return state;
  }

  private async reclaimIdleSessions(excludeKey: string): Promise<void> {
    const deadline = Date.now() - this.configuration.runtime.idleTimeoutMs;
    const stale = [...this.sessions.values()].filter(
      (session) =>
        session.key !== excludeKey && session.lastActivityAt <= deadline && !this.sessionQueues.has(session.key),
    );
    await Promise.all(stale.map((session) => this.disposeSession(session).catch(() => undefined)));
  }

  private async runInSession<TValue>(
    key: string,
    signal: AbortSignal,
    operation: () => Promise<TValue>,
  ): Promise<TValue> {
    const predecessor = this.sessionQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const completion = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = predecessor.catch(() => undefined).then(() => completion);
    this.sessionQueues.set(key, queued);
    try {
      await awaitBrowserQueueTurn(predecessor, signal);
      if (this.closed) throw new AgentBrowserRuntimeError("The controlled browser runtime is closed.");
      return await operation();
    } finally {
      release();
      if (this.sessionQueues.get(key) === queued) this.sessionQueues.delete(key);
    }
  }

  private async prepareArguments(
    operation: AgentBrowserOperation,
    input: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<PreparedBrowserArguments> {
    const arguments_ = pickBrowserArguments(operation, input);
    if (
      operation === "open" ||
      (operation === "read" && typeof arguments_.url === "string") ||
      (operation === "tab_new" && typeof arguments_.url === "string")
    ) {
      arguments_.url = await this.admitNavigationUrl(String(arguments_.url), signal);
    }
    if (operation === "screenshot") {
      const requested = arguments_.format;
      arguments_.format =
        requested === "jpeg" || requested === "png" ? requested : this.configuration.capture.defaultFormat;
    }
    return {
      arguments: arguments_,
      timeoutMs: resolveBrowserOperationTimeout(operation, input, this.configuration),
    };
  }

  private async admitNavigationUrl(value: string, signal: AbortSignal): Promise<string> {
    const url = await this.assertSafeUrl(value, signal);
    if (this.configuration.network.accessMode === "allowlist") this.assertAllowedDomain(url.hostname, "navigation");
    return url.toString();
  }

  private async assertRequestPermitted(value: string, kind: AgentBrowserNetworkRequestKind): Promise<void> {
    const url = await this.assertSafeUrl(value);
    if (this.configuration.network.accessMode === "allowlist") this.assertAllowedDomain(url.hostname, kind);
  }

  private async assertSafeUrl(value: string, signal?: AbortSignal): Promise<URL> {
    const url = await assertSafeWebUrl(
      value,
      {
        maxUrlLength: this.configuration.runtime.maxUrlLength,
        allowPrivateNetworks: this.configuration.network.allowPrivateNetworks,
        allowSyntheticProxyAddresses: this.configuration.network.allowSyntheticProxyAddresses,
      },
      this.options.resolveHostAddresses,
    );
    if (signal) assertNotAborted(signal);
    return url;
  }

  private assertAllowedDomain(hostname: string, kind: AgentBrowserNetworkRequestKind): void {
    const configured = this.configuration.network.allowedDomains;
    if (configured.length === 0) {
      throw new AgentBrowserRuntimeError(
        `Browser ${kind === "navigation" ? "navigation" : "request"} is blocked because the configured allowlist is empty.`,
      );
    }
    if (configured.some((pattern) => matchesAgentBrowserDomain(hostname, pattern))) return;
    throw new AgentBrowserRuntimeError(
      `${kind === "navigation" ? "Browser navigation" : "Browser request"} to ${hostname} is outside the configured allowed domains.`,
    );
  }

  private async driverSessionFor(
    state: AgentBrowserSessionState,
    signal: AbortSignal,
  ): Promise<AgentBrowserDriverSession> {
    if (state.driverSession) return state.driverSession;
    const opening =
      state.opening ??
      this.driver.createSession({
        requestTimeoutMs: this.configuration.runtime.requestTimeoutMs,
        maxDownloadBytes: this.configuration.capture.maxDownloadBytes,
        assertRequestPermitted: (url, kind) => this.assertRequestPermitted(url, kind),
      });
    state.opening = opening;
    void opening
      .then((session) => {
        if (this.closed || this.sessions.get(state.key) !== state) void session.close().catch(() => undefined);
      })
      .catch(() => undefined);
    try {
      const session = await awaitBrowserCreation(opening, signal);
      if (this.closed || this.sessions.get(state.key) !== state) {
        await session.close().catch(() => undefined);
        throw new AgentBrowserRuntimeError(
          "The controlled browser session was closed while starting.",
          AgentExecutionErrorCodes.ToolProcessCancelled,
        );
      }
      state.driverSession = session;
      state.opening = undefined;
      return session;
    } catch (error) {
      if (state.opening === opening) state.opening = undefined;
      throw error;
    }
  }

  private async disposeSession(state: AgentBrowserSessionState): Promise<void> {
    if (this.sessions.get(state.key) === state) this.sessions.delete(state.key);
    await this.closeSession(state);
  }

  private async closeSession(state: AgentBrowserSessionState): Promise<void> {
    const session = state.driverSession;
    state.driverSession = undefined;
    if (session) {
      await session.close();
      return;
    }
    const opening = state.opening;
    if (opening) void opening.then((created) => created.close()).catch(() => undefined);
  }

  private projectResult(
    operation: AgentBrowserOperation,
    raw: AgentBrowserDriverOperationResult,
    arguments_: Readonly<Record<string, unknown>>,
  ): BrowserOperationProjection {
    const content = truncateText(raw.content ?? "", this.configuration.runtime.outputMaxChars);
    const screenshot = raw.screenshot
      ? this.createScreenshotAsset(raw.screenshot.data, raw.screenshot.mediaType)
      : undefined;
    const download = raw.download ? this.createDownloadAsset(raw.download) : undefined;
    const result: AgentBrowserOperationResult = {
      status: "completed",
      summary: OperationSummary[operation],
      trust: BrowserContentTrust,
      truncated: content.truncated,
      ...(content.value ? { content: content.value } : {}),
      ...(raw.page ? { page: raw.page } : {}),
      ...(screenshot
        ? {
            screenshot: {
              assetId: screenshot.id,
              mediaType: screenshot.mediaType,
              markdown: `![Browser screenshot](${createAgentResourceUri(createAgentResourceId(screenshot.id))})`,
            },
          }
        : {}),
      ...(download
        ? {
            download: {
              assetId: download.asset.id,
              fileName: download.asset.fileName,
              mediaType: download.asset.mediaType,
              markdown: `[${download.asset.fileName}](${createAgentResourceUri(createAgentResourceId(download.asset.id))})`,
            },
          }
        : {}),
    };
    return {
      result,
      artifactPayload: this.createArtifactPayload(operation, content.value, raw.page, screenshot, download, arguments_),
    };
  }

  private createScreenshotAsset(data: Uint8Array, mediaType: "image/png" | "image/jpeg"): AgentToolArtifactAsset {
    if (data.byteLength > this.configuration.capture.maxScreenshotBytes) {
      throw new AgentBrowserRuntimeError(
        `Browser screenshot exceeds the configured ${this.configuration.capture.maxScreenshotBytes} byte limit.`,
      );
    }
    const id = `browser-screenshot-${randomUUID().replace(/-/gu, "")}`;
    return {
      id,
      fileName: `${id}.${mediaType === "image/jpeg" ? "jpg" : "png"}`,
      mediaType,
      dataBase64: Buffer.from(data).toString("base64"),
    };
  }

  private createDownloadAsset(download: AgentBrowserDriverDownload): BrowserDownloadProjection {
    if (download.data.byteLength > this.configuration.capture.maxDownloadBytes) {
      throw new AgentBrowserRuntimeError(
        `Browser download exceeds the configured ${this.configuration.capture.maxDownloadBytes} byte limit.`,
      );
    }
    const fileName = normalizeDownloadFileName(download.fileName);
    const id = `browser-download-${randomUUID().replace(/-/gu, "")}`;
    return {
      asset: {
        id,
        fileName,
        mediaType: lookupDownloadMimeType(fileName),
        dataBase64: Buffer.from(download.data).toString("base64"),
      },
      sourceUrl: download.url,
    };
  }

  private createArtifactPayload(
    operation: AgentBrowserOperation,
    content: string,
    page: AgentBrowserDriverOperationResult["page"],
    screenshot: AgentToolArtifactAsset | undefined,
    download: BrowserDownloadProjection | undefined,
    arguments_: Readonly<Record<string, unknown>>,
  ): AgentToolArtifactPayload {
    const evidenceContent = truncateText(content, 1_024).value;
    const assets = [screenshot, download?.asset].filter(
      (asset): asset is AgentToolArtifactAsset => asset !== undefined,
    );
    return {
      rawResponse: {
        source: "browser",
        backend: "playwright",
        operation,
        input: sanitizeBrowserInput(arguments_),
        ...(content ? { content } : {}),
        ...(page ? { page } : {}),
        ...(screenshot ? { screenshot: { assetId: screenshot.id, mediaType: screenshot.mediaType } } : {}),
        ...(download
          ? {
              download: {
                assetId: download.asset.id,
                fileName: download.asset.fileName,
                mediaType: download.asset.mediaType,
                url: download.sourceUrl,
              },
            }
          : {}),
      },
      ...(assets.length > 0 ? { assets } : {}),
      evidence: [
        ...(evidenceContent
          ? [
              {
                key: `browser-content:${operation}:${sha256Hex(evidenceContent).slice(0, 16)}`,
                kind: "browser_content",
                locator: `browser:${operation}`,
                display: evidenceContent,
                label: "Untrusted browser content",
                source: "browser",
                confidence: 0.5,
                metadata: { trust: BrowserContentTrust, backend: "playwright" },
              },
            ]
          : []),
        ...(screenshot
          ? [
              {
                key: `browser-screenshot:${screenshot.id}`,
                kind: "browser_screenshot",
                locator: `asset:${screenshot.id}`,
                display: screenshot.fileName,
                label: "Browser screenshot",
                source: "browser",
                confidence: 1,
                artifactRefs: [screenshot.id],
                metadata: { trust: BrowserContentTrust, mediaType: screenshot.mediaType, backend: "playwright" },
              },
            ]
          : []),
        ...(download
          ? [
              {
                key: `browser-download:${download.asset.id}`,
                kind: "browser_download",
                locator: `asset:${download.asset.id}`,
                display: download.asset.fileName,
                label: "Browser download",
                source: "browser",
                confidence: 1,
                artifactRefs: [download.asset.id],
                metadata: {
                  trust: BrowserContentTrust,
                  mediaType: download.asset.mediaType,
                  sourceUrl: download.sourceUrl,
                  backend: "playwright",
                },
              },
            ]
          : []),
      ],
    };
  }

  private toRuntimeError(error: unknown): AgentBrowserRuntimeError {
    if (error instanceof AgentBrowserRuntimeError) return error;
    if (error instanceof AgentBrowserExecutableResolutionError) {
      return new AgentBrowserRuntimeError(error.message, AgentExecutionErrorCodes.ToolProcessConfigurationInvalid, {
        cause: error,
      });
    }
    const message = errorMessage(error);
    const timeout = (error as { readonly name?: unknown }).name === "TimeoutError" || /\btimeout\b/iu.test(message);
    return new AgentBrowserRuntimeError(
      message,
      timeout ? AgentExecutionErrorCodes.ToolProcessTimeout : AgentExecutionErrorCodes.ToolExecutionError,
      { cause: error },
    );
  }
}

interface BrowserOperationProjection {
  readonly result: AgentBrowserOperationResult;
  readonly artifactPayload: AgentToolArtifactPayload;
}

interface BrowserDownloadProjection {
  readonly asset: AgentToolArtifactAsset;
  readonly sourceUrl: string;
}

interface PreparedBrowserArguments {
  readonly arguments: Record<string, unknown>;
  readonly timeoutMs: number;
}

function resolveBrowserOperationTimeout(
  operation: AgentBrowserOperation,
  input: Readonly<Record<string, unknown>>,
  configuration: AgentBrowserConfiguration,
): number {
  const requested = input.timeoutMs ?? (isConditionalBrowserWait(operation) ? input.waitTimeoutMs : undefined);
  if (requested === undefined) return configuration.runtime.requestTimeoutMs;
  if (
    typeof requested !== "number" ||
    !Number.isInteger(requested) ||
    requested < 1_000 ||
    requested > configuration.runtime.maxOperationTimeoutMs
  ) {
    throw new AgentBrowserRuntimeError(
      `Browser timeoutMs must be an integer between 1000 and ${configuration.runtime.maxOperationTimeoutMs}.`,
    );
  }
  return requested;
}

function isConditionalBrowserWait(operation: AgentBrowserOperation): boolean {
  return operation === "wait_for_selector" || operation === "wait_for_text" || operation === "wait_for_load";
}

function pickBrowserArguments(
  operation: AgentBrowserOperation,
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    PublicArgumentsByOperation[operation].filter((key) => input[key] !== undefined).map((key) => [key, input[key]]),
  );
}

function sanitizeBrowserInput(input: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return sanitizeBrowserValue(input) as Record<string, unknown>;
}

function sanitizeBrowserValue(value: unknown, key?: string): unknown {
  if (key === "text" && typeof value === "string") return `[${Array.from(value).length} characters]`;
  if (Array.isArray(value)) return value.map((entry) => sanitizeBrowserValue(entry));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitizeBrowserValue(entryValue, entryKey)]),
  );
}

function normalizeDownloadFileName(value: string): string {
  const fileName = [...path.basename(value.replaceAll("\\", "/"))]
    .map((character) => (isUnsafeDownloadFileNameCharacter(character) ? "_" : character))
    .join("")
    .trim();
  if (!fileName || fileName === "." || fileName === "..") {
    throw new AgentBrowserRuntimeError("Browser download did not provide a usable file name.");
  }
  return fileName;
}

function isUnsafeDownloadFileNameCharacter(value: string): boolean {
  return (value.codePointAt(0) ?? 0) < 32 || '<>:"/\\|?*'.includes(value);
}

function lookupDownloadMimeType(fileName: string): string {
  const mediaType = lookupMimeType(fileName);
  return typeof mediaType === "string" ? mediaType : "application/octet-stream";
}

function truncateText(value: string, maxChars: number): { readonly value: string; readonly truncated: boolean } {
  const characters = Array.from(value);
  if (characters.length <= maxChars) return { value, truncated: false };
  return {
    value: `${characters.slice(0, maxChars).join("")}\n\n[Browser output truncated by Senera.]`,
    truncated: true,
  };
}

function awaitBrowserQueueTurn(previous: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Operation aborted.", "AbortError"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Operation aborted.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    void previous.then(
      () => {
        signal.removeEventListener("abort", abort);
        resolve();
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function awaitBrowserCreation<TValue>(creation: Promise<TValue>, signal: AbortSignal): Promise<TValue> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Operation aborted.", "AbortError"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Operation aborted.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    void creation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function composeBrowserSignals(signal: AbortSignal | undefined, shutdownSignal: AbortSignal): AbortSignal {
  return signal ? AbortSignal.any([signal, shutdownSignal]) : shutdownSignal;
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException("Browser operation aborted.", "AbortError");
}
