import { spawn, type ChildProcessByStdio } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { resolveAgentBrowserController } from "./AgentBrowserControllerResolver.js";
import { removeAgentPathWithRetry } from "../Core/AgentFs.js";
import { sha256Hex } from "../Core/AgentHash.js";
import type { AgentBrowserConfiguration } from "./AgentBrowserConfiguration.js";
import {
  assertAgentBrowserWindowModeSupported,
  resolveAgentBrowserExecutable,
} from "./AgentBrowserExecutableResolver.js";
import type {
  AgentBrowserDriver,
  AgentBrowserDriverDownload,
  AgentBrowserDriverOperationOptions,
  AgentBrowserDriverOperationResult,
  AgentBrowserDriverScreenshot,
  AgentBrowserDriverSession,
  AgentBrowserDriverSessionOptions,
} from "./AgentBrowserDriver.js";
import {
  AgentBrowserComputerActionTypes,
  type AgentBrowserComputerAction,
  type AgentBrowserOperation,
} from "./AgentBrowserTypes.js";

interface AgentBrowserCommandEnvelope {
  readonly success?: boolean;
  readonly data?: unknown;
  readonly error?: unknown;
  readonly code?: unknown;
}

interface AgentNativeBrowserDriverOptions {
  readonly workspaceRoot: string;
  readonly resourcesPath?: string;
  readonly configuration: AgentBrowserConfiguration;
  readonly resolveExecutable?: () => string;
  readonly resolveController?: () => string;
  readonly environment?: NodeJS.ProcessEnv;
}

export class AgentNativeBrowserCommandError extends Error {
  override name = "AgentNativeBrowserCommandError";

  constructor(
    message: string,
    readonly command: readonly string[],
    readonly commandCode?: string,
  ) {
    super(message);
  }
}

/**
 * Senera's browser driver backed by the official agent-browser native CLI.
 * The host keeps session ownership, URL admission and artifact limits while
 * the CLI owns browser/CDP lifecycle and its accessibility reference model.
 */
export class AgentNativeBrowserDriver implements AgentBrowserDriver {
  readonly backend = "agent-browser";
  private readonly sessions = new Set<AgentNativeBrowserSession>();
  private closed = false;
  private closing = false;
  private closePromise: Promise<void> | undefined;
  private controllerPath: string | undefined;
  private readonly networkPolicySessions = new Set<string>();

  constructor(private readonly options: AgentNativeBrowserDriverOptions) {}

  async createSession(options: AgentBrowserDriverSessionOptions): Promise<AgentBrowserDriverSession> {
    if (this.closed || this.closing) throw new Error("The controlled browser driver is closed.");
    const session = new AgentNativeBrowserSession(this, options);
    this.sessions.add(session);
    return session;
  }

  async run(sessionId: string, args: readonly string[], options: AgentBrowserDriverOperationOptions): Promise<unknown> {
    if (this.closed) throw new Error("The controlled browser driver is closed.");
    await this.ensureNetworkPolicy(sessionId, options);
    const command = [...this.globalArguments(sessionId, options.headed), ...args];
    const controller = this.controller();
    return runAgentBrowserCommand(controller, command, this.options.workspaceRoot, this.options.environment, options);
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    const closing = Promise.allSettled([...this.sessions].map((session) => session.close())).then((outcomes) => {
      this.closed = true;
      const failures = outcomes
        .filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected")
        .map((outcome) => outcome.reason);
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "Native browser driver cleanup failed.");
    });
    this.closePromise = closing;
    return closing;
  }

  forget(session: AgentNativeBrowserSession): void {
    this.sessions.delete(session);
    this.networkPolicySessions.delete(session.sessionId);
  }

  private async ensureNetworkPolicy(sessionId: string, options: AgentBrowserDriverOperationOptions): Promise<void> {
    if (this.networkPolicySessions.has(sessionId)) return;
    for (const pattern of this.options.configuration.network.blockedDomains) {
      const route = agentBrowserRoutePattern(pattern);
      const command = [...this.globalArguments(sessionId, options.headed), "network", "route", route, "--abort"];
      await runAgentBrowserCommand(
        this.controller(),
        command,
        this.options.workspaceRoot,
        this.options.environment,
        options,
      );
    }
    this.networkPolicySessions.add(sessionId);
  }

  private controller(): string {
    this.controllerPath ??=
      this.options.resolveController?.() ??
      resolveAgentBrowserController({
        configuredPath: this.options.configuration.runtime.controllerPath,
        resourcesPath: this.options.resourcesPath,
        workspaceRoot: this.options.workspaceRoot,
        environment: this.options.environment,
      });
    return this.controllerPath;
  }

  private globalArguments(sessionId: string, headed = this.options.configuration.runtime.headed): string[] {
    const args = ["--json", "--session", sessionId];
    const environment = this.options.environment ?? process.env;
    assertAgentBrowserWindowModeSupported({ headed, environment });
    const configuredExecutable = this.options.configuration.runtime.executablePath?.trim();
    if (configuredExecutable) {
      const executable =
        this.options.resolveExecutable?.() ??
        resolveAgentBrowserExecutable({
          configuredPath: configuredExecutable,
          workspaceRoot: this.options.workspaceRoot,
        });
      args.push("--executable-path", executable);
    }
    if (headed) args.push("--headed");
    args.push(
      "--idle-timeout",
      String(this.options.configuration.runtime.idleTimeoutMs),
      "--max-output",
      String(this.options.configuration.runtime.outputMaxChars),
      "--pin-tab",
    );
    if (environment.SENERA_CONTAINER === "1") {
      args.push("--args", `--disable-dev-shm-usage${process.getuid?.() === 0 ? ",--no-sandbox" : ""}`);
    }
    return args;
  }
}

class AgentNativeBrowserSession implements AgentBrowserDriverSession {
  private readonly tempDirectoryPromise = fs.mkdtemp(path.join(os.tmpdir(), "senera-agent-browser-"));
  private closed = false;

  constructor(
    private readonly driver: AgentNativeBrowserDriver,
    private readonly options: AgentBrowserDriverSessionOptions,
  ) {}

  get sessionId(): string {
    return this.options.sessionId;
  }

  async execute(
    operation: AgentBrowserOperation,
    input: Readonly<Record<string, unknown>>,
    options: AgentBrowserDriverOperationOptions,
  ): Promise<AgentBrowserDriverOperationResult> {
    if (this.closed) throw new Error("The controlled browser session is closed.");
    const result = await this.executeOperation(operation, input, options);
    if (operation === "close" || operation === "tab_list" || operation === "read" || operation === "render_html")
      return result;
    if (operation === "tab_close" && !result.page) return result;
    return { ...result, page: await this.pageState(options) };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.driver.run(this.options.sessionId, ["close"], { timeoutMs: this.options.requestTimeoutMs });
    } finally {
      this.driver.forget(this);
      const directory = await this.tempDirectoryPromise;
      await removeAgentPathWithRetry(directory, { recursive: true });
    }
  }

  private async executeOperation(
    operation: AgentBrowserOperation,
    input: Readonly<Record<string, unknown>>,
    options: AgentBrowserDriverOperationOptions,
  ): Promise<AgentBrowserDriverOperationResult> {
    switch (operation) {
      case "open": {
        const url = requiredString(input, "url");
        await this.options.assertRequestPermitted(url, "navigation");
        const data = await this.run(["open", url], options);
        return { content: pageDescription(data), page: pageFromData(data) };
      }
      case "render_html":
        return this.renderHtml(input, options);
      case "read": {
        const url = optionalString(input, "url");
        if (url) await this.options.assertRequestPermitted(url, "navigation");
        const data = await this.run(url ? ["read", url] : ["read"], options);
        const value = recordValue(data, "content") ?? recordValue(data, "text");
        return { ...(typeof value === "string" ? { content: value } : {}) };
      }
      case "snapshot":
        return { content: stringValue(await this.run(["snapshot", ...snapshotArguments(input)], options), "snapshot") };
      case "click":
        return { content: stringValue(await this.run(clickArguments(input), options), "clicked") };
      case "fill":
        return {
          content: stringValue(
            await this.run(["fill", requiredString(input, "selector"), requiredString(input, "text")], options),
            "filled",
          ),
        };
      case "type":
        return {
          content: stringValue(
            await this.run(
              optionalBoolean(input, "clear")
                ? ["fill", requiredString(input, "selector"), requiredString(input, "text")]
                : ["type", requiredString(input, "selector"), requiredString(input, "text")],
              options,
            ),
            optionalBoolean(input, "clear") ? "filled" : "typed",
          ),
        };
      case "press":
        return {
          content: await this.runSequential(requiredStringArray(input, "keys"), (key) => ["press", key], options),
        };
      case "check":
      case "uncheck":
        return {
          content: stringValue(await this.run([operation, requiredString(input, "selector")], options), operation),
        };
      case "select":
        return {
          content: await this.runSequential(
            requiredStringArray(input, "values"),
            (value) => ["select", requiredString(input, "selector"), value],
            options,
          ),
        };
      case "scroll": {
        const selector = optionalString(input, "selector");
        if (selector) await this.run(["scrollintoview", selector], options);
        const direction = optionalString(input, "direction") ?? "down";
        const amount = optionalNumber(input, "amount") ?? 600;
        return { content: stringValue(await this.run(["scroll", direction, String(amount)], options), "scrolled") };
      }
      case "wait_ms":
        return {
          content: stringValue(await this.run(["wait", String(optionalNumber(input, "ms") ?? 0)], options), "waited"),
        };
      case "wait_for_selector":
        return { content: stringValue(await this.run(["wait", requiredString(input, "selector")], options), "waited") };
      case "wait_for_text":
        return {
          content: stringValue(await this.run(["wait", "--text", requiredString(input, "text")], options), "waited"),
        };
      case "wait_for_load":
        return {
          content: stringValue(await this.run(["wait", "--load", requiredString(input, "state")], options), "waited"),
        };
      case "screenshot":
        return this.screenshot(input, options);
      case "get_text":
        return {
          content: stringValue(await this.run(["get", "text", requiredString(input, "selector")], options), "text"),
        };
      case "get_url":
        return { content: stringValue(await this.run(["get", "url"], options), "url") };
      case "get_title":
        return { content: stringValue(await this.run(["get", "title"], options), "title") };
      case "close":
        return { content: "Controlled browser session closed." };
      case "back":
      case "forward":
      case "reload":
        return { content: stringValue(await this.run([operation], options), operation) };
      case "tab_new": {
        const args = ["tab", "new"];
        const label = optionalString(input, "label");
        if (label) args.push("--label", label);
        const url = optionalString(input, "url");
        if (url) {
          await this.options.assertRequestPermitted(url, "navigation");
          args.push(url);
        }
        return { content: stringValue(await this.run(args, options), "tab") };
      }
      case "tab_list":
        return { content: tabListContent(await this.run(["tab", "list"], options)) };
      case "tab_switch":
        return { content: stringValue(await this.run(["tab", requiredString(input, "tab")], options), "tab") };
      case "tab_close": {
        const tab = optionalString(input, "tab");
        return { content: stringValue(await this.run(tab ? ["tab", "close", tab] : ["tab", "close"], options), "tab") };
      }
      case "download":
        return this.download(requiredString(input, "selector"), options);
      case "computer":
        return this.computer(input, options);
    }
  }

  private async renderHtml(
    input: Readonly<Record<string, unknown>>,
    options: AgentBrowserDriverOperationOptions,
  ): Promise<AgentBrowserDriverOperationResult> {
    const renderOptions = { ...options, headed: false };
    const operationDeadline = Date.now() + renderOptions.timeoutMs;
    const url = requiredString(input, "url");
    await this.options.assertRequestPermitted(url, "navigation");
    const opened = await this.runWithRemaining(["open", url], renderOptions, operationDeadline);
    const settleTimeoutMs = requiredPositiveNumber(input, "settleTimeoutMs");
    const pollMs = requiredPositiveNumber(input, "settlePollMs");
    const stableSamples = requiredPositiveInteger(input, "stableSamples");
    const deadline = Math.min(operationDeadline, Date.now() + settleTimeoutMs);
    await this.runWithRemaining(
      ["wait", String(Math.min(pollMs, Math.max(1, deadline - Date.now())))],
      renderOptions,
      deadline,
    );
    let html = await this.readHtml(renderOptions, deadline);
    let signature = renderedHtmlSignature(html);
    let stable = 1;
    while (stable < stableSamples && Date.now() < deadline) {
      await this.runWithRemaining(
        ["wait", String(Math.min(pollMs, Math.max(1, deadline - Date.now())))],
        renderOptions,
        deadline,
      );
      const next = await this.readHtml(renderOptions, deadline);
      const nextSignature = renderedHtmlSignature(next);
      if (nextSignature === signature) stable += 1;
      else {
        stable = 1;
        signature = nextSignature;
      }
      html = next;
    }
    return { content: html, page: pageFromData(opened) ?? (await this.pageStateWithDeadline(renderOptions, deadline)) };
  }

  private async readHtml(options: AgentBrowserDriverOperationOptions, deadline: number): Promise<string> {
    const data = await this.runWithRemaining(["get", "html", "html"], options, deadline);
    const value = recordValue(data, "html");
    if (typeof value !== "string") throw new Error("agent-browser did not return rendered HTML.");
    return value;
  }

  private async pageStateWithDeadline(options: AgentBrowserDriverOperationOptions, deadline: number) {
    const [url, title] = await Promise.all([
      this.runWithRemaining(["get", "url"], options, deadline).then((data) => stringValue(data, "url")),
      this.runWithRemaining(["get", "title"], options, deadline).then((data) => stringValue(data, "title")),
    ]);
    return { url, title };
  }

  private async runWithRemaining(
    args: readonly string[],
    options: AgentBrowserDriverOperationOptions,
    deadline: number,
  ): Promise<unknown> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new DOMException("Browser rendering timed out.", "TimeoutError");
    return this.run(args, { ...options, timeoutMs: Math.min(options.timeoutMs, remaining) });
  }

  private async screenshot(
    input: Readonly<Record<string, unknown>>,
    options: AgentBrowserDriverOperationOptions,
  ): Promise<AgentBrowserDriverOperationResult> {
    const directory = await this.tempDirectoryPromise;
    const format = optionalString(input, "format") === "jpeg" ? "jpeg" : "png";
    const output = path.join(directory, `screenshot-${Date.now()}.${format === "jpeg" ? "jpg" : "png"}`);
    const args = ["screenshot"];
    const selector = optionalString(input, "selector");
    if (selector) args.push(selector);
    args.push(output);
    if (optionalBoolean(input, "fullPage")) args.push("--full");
    if (optionalBoolean(input, "annotate")) args.push("--annotate");
    args.push("--screenshot-format", format);
    await this.run(args, options);
    const data = await fs.readFile(output);
    const screenshot: AgentBrowserDriverScreenshot = {
      data,
      mediaType: format === "jpeg" ? "image/jpeg" : "image/png",
    };
    return { content: "Captured browser screenshot.", screenshot };
  }

  private async download(
    selector: string,
    options: AgentBrowserDriverOperationOptions,
  ): Promise<AgentBrowserDriverOperationResult> {
    const directory = await this.tempDirectoryPromise;
    const output = path.join(directory, `download-${Date.now()}`);
    const hrefData = await this.run(["get", "attr", selector, "href"], options);
    const sourceUrl = recordValue(hrefData, "value") ?? recordValue(hrefData, "text");
    if (typeof sourceUrl !== "string" || !sourceUrl) throw new Error("Browser download target did not expose an href.");
    const sourcePage = stringValue(await this.run(["get", "url"], options), "url");
    await this.options.assertRequestPermitted(sourceUrl, "subresource", sourcePage);
    await this.run(["download", selector, output], options);
    const data = await fs.readFile(output);
    const fileName = path.basename(new URL(sourceUrl).pathname) || "download";
    const download: AgentBrowserDriverDownload = { data, fileName, url: sourceUrl };
    return { content: `Downloaded ${fileName}.`, download };
  }

  private async computer(input: Readonly<Record<string, unknown>>, options: AgentBrowserDriverOperationOptions) {
    const actions = input.actions;
    if (!Array.isArray(actions)) throw new Error("Computer actions must be an array.");
    let latest: AgentBrowserDriverOperationResult = { content: "Completed browser computer actions." };
    for (const value of actions) {
      const action = validateComputerAction(value);
      switch (action.type) {
        case "click":
        case "double_click":
          assertNoModifiers(action);
          await this.run(["mouse", "move", String(action.x), String(action.y)], options);
          await this.run(["mouse", "down", action.button ?? "left"], options);
          await this.run(["mouse", "up", action.button ?? "left"], options);
          if (action.type === "double_click") {
            await this.run(["mouse", "down", action.button ?? "left"], options);
            await this.run(["mouse", "up", action.button ?? "left"], options);
          }
          break;
        case "move":
          assertNoModifiers(action);
          await this.run(["mouse", "move", String(action.x), String(action.y)], options);
          break;
        case "scroll":
          assertNoModifiers(action);
          await this.run(
            ["mouse", "wheel", String(action.scrollY ?? action.y), String(action.scrollX ?? action.x)],
            options,
          );
          break;
        case "drag":
          assertNoModifiers(action);
          for (const [index, point] of action.path.entries()) {
            await this.run(["mouse", "move", String(point.x), String(point.y)], options);
            if (index === 0) await this.run(["mouse", "down", "left"], options);
          }
          await this.run(["mouse", "up", "left"], options);
          break;
        case "type":
          await this.run(["keyboard", "type", action.text], options);
          break;
        case "keypress":
          await this.runSequential(action.keys, (key) => ["press", key], options);
          break;
        case "wait":
          await this.run(["wait", String(action.ms)], options);
          break;
        case "screenshot":
          latest = await this.screenshot({}, options);
          break;
      }
    }
    return latest;
  }

  private async run(args: readonly string[], options: AgentBrowserDriverOperationOptions): Promise<unknown> {
    return this.driver.run(this.options.sessionId, args, options);
  }

  private async runSequential(
    values: readonly string[],
    command: (value: string) => readonly string[],
    options: AgentBrowserDriverOperationOptions,
  ): Promise<string> {
    let latest = "";
    for (const value of values) latest = stringValue(await this.run(command(value), options), "message");
    return latest;
  }

  private async pageState(options: AgentBrowserDriverOperationOptions) {
    const [url, title] = await Promise.all([
      this.run(["get", "url"], options).then((data) => stringValue(data, "url")),
      this.run(["get", "title"], options).then((data) => stringValue(data, "title")),
    ]);
    return { url, title };
  }
}

async function runAgentBrowserCommand(
  controller: string,
  command: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv | undefined,
  options: AgentBrowserDriverOperationOptions,
): Promise<unknown> {
  const child = spawn(controller, command, {
    cwd,
    env: environment ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const output = await collectChildOutput(child, command, options);
  const envelope = parseEnvelope(output.stdout, command);
  if (envelope.success === false) {
    const message = typeof envelope.error === "string" ? envelope.error : JSON.stringify(envelope.error);
    throw new AgentNativeBrowserCommandError(
      message || "agent-browser command failed.",
      command,
      stringValue(envelope.code, "code"),
    );
  }
  return envelope.data;
}

function collectChildOutput(
  child: ChildProcessByStdio<null, Readable, Readable>,
  command: readonly string[],
  options: AgentBrowserDriverOperationOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new AgentNativeBrowserCommandError("agent-browser command timed out.", command, "timeout")));
    }, options.timeoutMs);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => {
      child.kill();
      finish(() => reject(options.signal?.reason ?? new Error("agent-browser command was cancelled.")));
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.split(/\r?\n/gu).some((line) => isJsonEnvelopeLine(line))) {
        child.kill();
        finish(() => resolve({ stdout, stderr }));
      }
    });
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => {
      if (code !== 0) {
        finish(() =>
          reject(
            new AgentNativeBrowserCommandError(
              stderr.trim() || `agent-browser exited with code ${code}.`,
              command,
              undefined,
            ),
          ),
        );
        return;
      }
      finish(() => resolve({ stdout, stderr }));
    });
    if (options.signal) {
      if (options.signal.aborted) abort();
      else options.signal.addEventListener("abort", abort, { once: true });
    }
  });
}

function parseEnvelope(stdout: string, command: readonly string[]): AgentBrowserCommandEnvelope {
  const lines = stdout
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean);
  const line = lines.at(-1);
  if (!line) throw new AgentNativeBrowserCommandError("agent-browser returned no JSON response.", command);
  try {
    const value = JSON.parse(line) as unknown;
    if (!value || typeof value !== "object") throw new Error("response is not an object");
    return value as AgentBrowserCommandEnvelope;
  } catch (error) {
    throw new AgentNativeBrowserCommandError(
      `agent-browser returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      command,
    );
  }
}

function isJsonEnvelopeLine(line: string): boolean {
  const candidate = line.trim();
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return false;
  try {
    const value = JSON.parse(candidate) as unknown;
    return Boolean(value && typeof value === "object" && ("success" in value || "error" in value));
  } catch {
    return false;
  }
}

function snapshotArguments(input: Readonly<Record<string, unknown>>): string[] {
  const args: string[] = [];
  if (input.interactive === true) args.push("-i");
  if (input.includeUrls === true) args.push("--urls");
  if (input.compact === true) args.push("-c");
  if (typeof input.depth === "number") args.push("-d", String(input.depth));
  if (typeof input.selector === "string" && input.selector) args.push("-s", input.selector);
  return args;
}

function clickArguments(input: Readonly<Record<string, unknown>>): string[] {
  const args = ["click", requiredString(input, "selector")];
  if (input.newTab === true) args.push("--new-tab");
  return args;
}

function agentBrowserRoutePattern(domainPattern: string): string {
  const hostPattern = domainPattern === "*" ? "**" : domainPattern;
  return `**://${hostPattern}/**`;
}

function pageFromData(value: unknown): { url: string; title: string } | undefined {
  const url = recordValue(value, "url");
  const title = recordValue(value, "title");
  return typeof url === "string" && typeof title === "string" ? { url, title } : undefined;
}

function pageDescription(value: unknown): string {
  const page = pageFromData(value);
  return page ? `${page.title}\n${page.url}` : "Opened browser page.";
}

function tabListContent(value: unknown): string {
  const tabs = recordValue(value, "tabs");
  if (!Array.isArray(tabs)) return "No controlled browser tabs are open.";
  return tabs
    .map((tab) => {
      const entry = asRecord(tab);
      const active = entry.active === true ? "* " : "";
      return `${active}${String(entry.tabId ?? entry.targetId ?? "tab")}: ${String(entry.title ?? "")} ${String(entry.url ?? "")}`.trim();
    })
    .join("\n");
}

function validateComputerAction(value: unknown): AgentBrowserComputerAction {
  if (!value || typeof value !== "object") throw new Error("Computer action must be an object.");
  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string" || !AgentBrowserComputerActionTypes.includes(type as never)) {
    throw new Error(`Unsupported browser computer action: ${String(type)}.`);
  }
  return value as AgentBrowserComputerAction;
}

function assertNoModifiers(action: { readonly modifiers?: readonly string[] }): void {
  if (action.modifiers?.length)
    throw new Error("agent-browser mouse actions do not support modifier keys in this operation.");
}

function requiredString(input: Readonly<Record<string, unknown>>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value) throw new Error(`Browser operation requires ${key}.`);
  return value;
}

function requiredPositiveNumber(input: Readonly<Record<string, unknown>>, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Browser operation requires ${key} as a positive number.`);
  }
  return value;
}

function requiredPositiveInteger(input: Readonly<Record<string, unknown>>, key: string): number {
  const value = requiredPositiveNumber(input, key);
  if (!Number.isInteger(value)) throw new Error(`Browser operation requires ${key} as a positive integer.`);
  return value;
}

function requiredStringArray(input: Readonly<Record<string, unknown>>, key: string): string[] {
  const value = input[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new Error(`Browser operation requires ${key} as strings.`);
  return value as string[];
}

function optionalString(input: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value ? value : undefined;
}

function optionalBoolean(input: Readonly<Record<string, unknown>>, key: string): boolean | undefined {
  return typeof input[key] === "boolean" ? (input[key] as boolean) : undefined;
}

function optionalNumber(input: Readonly<Record<string, unknown>>, key: string): number | undefined {
  return typeof input[key] === "number" && Number.isFinite(input[key]) ? (input[key] as number) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function recordValue(value: unknown, key: string): unknown {
  return asRecord(value)[key];
}

function stringValue(value: unknown, key: string): string {
  const candidate = recordValue(value, key);
  if (typeof candidate === "string") return candidate;
  if (candidate !== undefined) return JSON.stringify(candidate);
  if (typeof value === "string") return value;
  return "Browser operation completed.";
}

function renderedHtmlSignature(value: string): string {
  return sha256Hex(value.replace(/\s+/gu, " ").trim());
}
