import {
  acquireAgentManagedBrowserProfile,
  managedBrowserOwnerSessionId,
  serializeManagedBrowserTabMutation,
  type AgentManagedBrowserProfileLease,
} from "./AgentManagedBrowserProfile.js";
import {
  AgentNativeBrowserCommandError,
  executeAgentBrowserCommand,
  type AgentNativeBrowserCommandExecutor,
} from "./AgentNativeBrowserCommand.js";

export {
  AgentNativeBrowserCommandError,
  agentBrowserCliEnvironment,
  agentBrowserCommandEnvironment,
  type AgentNativeBrowserCommandExecutor,
  type AgentNativeBrowserCommandRequest,
} from "./AgentNativeBrowserCommand.js";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import { resolveAgentBrowserController } from "./AgentBrowserControllerResolver.js";
import { removeAgentPathWithRetry } from "../Core/AgentFs.js";
import type { AgentBrowserConfiguration, AgentBrowserContext } from "./AgentBrowserConfiguration.js";
import { probeAgentBrowserCdpEndpoint } from "./AgentBrowserCdpEndpoint.js";
import {
  downloadAgentBrowserFile,
  type AgentBrowserCdpDownloader,
  type AgentBrowserCdpDownloadRequest,
  type AgentBrowserCdpDownloadResult,
} from "./AgentBrowserCdpDownload.js";
import {
  assertAgentBrowserWindowModeSupported,
  resolveAgentBrowserExecutableSelection,
} from "./AgentBrowserExecutableResolver.js";
import type {
  AgentBrowserDriver,
  AgentBrowserDriverDownload,
  AgentBrowserDriverOperationOptions,
  AgentBrowserDriverOperationResult,
  AgentBrowserDriverSession,
  AgentBrowserDriverSessionOptions,
} from "./AgentBrowserDriver.js";
import type { AgentBrowserOperation } from "./AgentBrowserTypes.js";
import { withAgentBrowserOperationDeadline } from "./AgentBrowserOperationDeadline.js";
import {
  captureAgentBrowserScreenshot,
  screenshotBox,
  type AgentBrowserCdpScreenshotRequest,
  type AgentBrowserCdpScreenshotter,
  type AgentBrowserScreenshotAnnotation,
  type AgentBrowserScreenshotBox,
} from "./AgentBrowserCdpScreenshot.js";

import {
  readBrowserCdpUrl,
  isUncertainBrowserNavigation,
  navigationBudgetError,
  isBrowserTabGoneFailure,
  isBrowserDaemonResponseLoss,
  isRetryableBrowserWaitFailure,
  isRetryableBrowserReadFailure,
  browserNavigationCommitted,
  snapshotArguments,
  clickArguments,
  agentBrowserRoutePattern,
  pageFromData,
  pageDescription,
  browserTargetId,
  browserTabs,
  onlyNewBrowserTabTarget,
  browserTabMatches,
  tabListContent,
  validateComputerAction,
  assertNoModifiers,
  requiredString,
  requiredPositiveNumber,
  requiredPositiveInteger,
  requiredStringArray,
  optionalString,
  optionalBoolean,
  optionalNumber,
  recordValue,
  stringValue,
  renderedHtmlSignature,
  type AgentBrowserTab,
} from "./AgentNativeBrowserProtocol.js";

const ManagedBrowserProfileDirectoryName = "managed";

const AgentBrowserNavigationPollMs = 500;

type AgentBrowserTabBinding = "pin" | "unpin";

interface AgentBrowserNavigationOutcome {
  readonly data: unknown;
  /** The target URL was observed after an uncertain native navigation response. */
  readonly pending: boolean;
}

interface AgentNativeBrowserDriverOptions {
  readonly workspaceRoot: string;
  /** Application-owned root for stable Senera browser profiles. */
  readonly browserProfilesRoot?: string;
  readonly resourcesPath?: string;
  readonly configuration: AgentBrowserConfiguration;
  readonly resolveExecutable?: () => string | undefined;
  readonly resolveController?: () => string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly executeCommand?: AgentNativeBrowserCommandExecutor;
  readonly probeCdpEndpoint?: (cdpUrl: string) => Promise<boolean>;
  readonly downloader?: AgentBrowserCdpDownloader;
  readonly screenshotter?: AgentBrowserCdpScreenshotter;
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
  private readonly sessionContexts = new Map<string, AgentBrowserContext>();
  private readonly sessionCdpEndpoints = new Map<string, string>();
  private readonly commandExecutor: AgentNativeBrowserCommandExecutor;
  private readonly downloader: AgentBrowserCdpDownloader;
  private readonly screenshotter: AgentBrowserCdpScreenshotter;
  private managedProfile: Promise<AgentManagedBrowserProfileLease> | undefined;
  private browserExecutableResolved = false;
  private browserExecutablePath: string | undefined;

  constructor(private readonly options: AgentNativeBrowserDriverOptions) {
    this.commandExecutor = options.executeCommand ?? executeAgentBrowserCommand;
    this.downloader = options.downloader ?? downloadAgentBrowserFile;
    this.screenshotter = options.screenshotter ?? captureAgentBrowserScreenshot;
  }

  async createSession(options: AgentBrowserDriverSessionOptions): Promise<AgentBrowserDriverSession> {
    if (this.closed || this.closing) throw new Error("The controlled browser driver is closed.");
    const session = new AgentNativeBrowserSession(this, options);
    this.sessions.add(session);
    this.sessionContexts.set(options.sessionId, options.context ?? "temporary");
    return session;
  }

  async run(
    sessionId: string,
    args: readonly string[],
    options: AgentBrowserDriverOperationOptions,
    tabBinding: AgentBrowserTabBinding = "pin",
    input?: string,
  ): Promise<unknown> {
    if (this.closed) throw new Error("The controlled browser driver is closed.");
    const sessionArguments = await this.sessionArguments(sessionId, options, tabBinding);
    await this.ensureNetworkPolicy(sessionId, sessionArguments, options);
    const command = [...sessionArguments, ...args];
    if (args[0] === "wait" || args[0] === "read") {
      command.push("--timeout", String(options.timeoutMs));
    }
    return this.executeCommand(command, options, input);
  }

  async screenshotWithCdp(
    sessionId: string,
    request: Omit<AgentBrowserCdpScreenshotRequest, "cdpUrl">,
  ): Promise<AgentBrowserDriverOperationResult> {
    const cdpUrl = await this.sessionCdpUrl(sessionId, request.options);
    return this.screenshotter({ ...request, cdpUrl });
  }

  async preparePersistentSession(sessionId: string, options: AgentBrowserDriverOperationOptions): Promise<boolean> {
    if ((this.sessionContexts.get(sessionId) ?? "temporary") !== "persistent") return false;
    const profile = await this.managedProfileLease(options);
    const endpoint = await profile.endpoint();
    return this.bindSessionEndpoint(sessionId, endpoint.cdpUrl);
  }

  async downloadWithCdp(
    sessionId: string,
    directory: string,
    options: AgentBrowserDriverOperationOptions,
    targetId: string,
    maxBytes: number,
    source: AgentBrowserCdpDownloadRequest["source"],
    assertRequestPermitted: (url: string) => Promise<void>,
  ): Promise<AgentBrowserCdpDownloadResult> {
    const download = async () => {
      const cdpUrl = await this.sessionCdpUrl(sessionId, options);
      return this.downloader({
        cdpUrl,
        directory,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        targetId,
        maxBytes,
        source,
        assertRequestPermitted,
      });
    };
    return (this.sessionContexts.get(sessionId) ?? "temporary") === "persistent"
      ? serializeManagedBrowserTabMutation(this.managedProfileDirectory(), download)
      : download();
  }

  private async sessionCdpUrl(sessionId: string, options: AgentBrowserDriverOperationOptions): Promise<string> {
    if ((this.sessionContexts.get(sessionId) ?? "temporary") === "temporary") {
      return readBrowserCdpUrl(await this.run(sessionId, ["get", "cdp-url"], options));
    }
    return (await (await this.managedProfileLease(options)).endpoint()).cdpUrl;
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    const closing = this.closeDriver();
    this.closePromise = closing;
    return closing;
  }

  forget(session: AgentNativeBrowserSession): void {
    this.sessions.delete(session);
    this.networkPolicySessions.delete(session.sessionId);
    this.sessionContexts.delete(session.sessionId);
    this.sessionCdpEndpoints.delete(session.sessionId);
  }

  async withPersistentTabMutation<TValue>(sessionId: string, operation: () => Promise<TValue>): Promise<TValue> {
    if ((this.sessionContexts.get(sessionId) ?? "temporary") !== "persistent") return operation();
    return serializeManagedBrowserTabMutation(this.managedProfileDirectory(), operation);
  }

  private async closeDriver(): Promise<void> {
    const sessionOutcomes = await Promise.allSettled([...this.sessions].map((session) => session.close()));
    const profile = this.managedProfile;
    const profileOutcome = profile ? await Promise.allSettled([profile.then((lease) => lease.release())]) : [];
    this.closed = true;
    const failures = [...sessionOutcomes, ...profileOutcome]
      .filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected")
      .map((outcome) => outcome.reason);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Native browser driver cleanup failed.");
  }

  private async ensureNetworkPolicy(
    sessionId: string,
    sessionArguments: readonly string[],
    options: AgentBrowserDriverOperationOptions,
  ): Promise<void> {
    if (this.networkPolicySessions.has(sessionId)) return;
    for (const pattern of this.options.configuration.network.blockedDomains) {
      const route = agentBrowserRoutePattern(pattern);
      const command = [...sessionArguments, "network", "route", route, "--abort"];
      await this.executeCommand(command, options);
    }
    this.networkPolicySessions.add(sessionId);
  }

  private executeCommand(
    command: readonly string[],
    options: AgentBrowserDriverOperationOptions,
    input?: string,
  ): Promise<unknown> {
    options.signal?.throwIfAborted();
    const timeoutMs = Math.min(
      options.timeoutMs,
      options.deadlineAt === undefined ? options.timeoutMs : options.deadlineAt - Date.now(),
    );
    if (timeoutMs <= 0) throw new DOMException("Browser operation timed out.", "TimeoutError");
    return this.commandExecutor({
      controller: this.controller(),
      command,
      cwd: this.options.workspaceRoot,
      environment: this.options.environment,
      defaultTimeoutMs: this.options.configuration.runtime.requestTimeoutMs,
      ...(input === undefined ? {} : { input }),
      options: { ...options, timeoutMs },
    });
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

  private async sessionArguments(
    sessionId: string,
    options: AgentBrowserDriverOperationOptions,
    tabBinding: AgentBrowserTabBinding,
  ): Promise<readonly string[]> {
    if ((this.sessionContexts.get(sessionId) ?? "temporary") === "temporary") {
      return this.launchArguments(sessionId, { headed: options.headed, tabBinding });
    }
    const profile = await this.managedProfileLease(options);
    const endpoint = await profile.endpoint();
    this.bindSessionEndpoint(sessionId, endpoint.cdpUrl);
    return this.connectionArguments(sessionId, endpoint.cdpUrl, tabBinding);
  }

  private bindSessionEndpoint(sessionId: string, cdpUrl: string): boolean {
    const previous = this.sessionCdpEndpoints.get(sessionId);
    this.sessionCdpEndpoints.set(sessionId, cdpUrl);
    if (previous === undefined || previous === cdpUrl) return false;
    // A different browser now serves this profile. Session route rules were
    // attached to the old connection, so the next command reapplies them.
    this.networkPolicySessions.delete(sessionId);
    return true;
  }

  private launchArguments(
    sessionId: string,
    options: {
      readonly headed?: boolean;
      readonly idleTimeoutMs?: number;
      readonly tabBinding?: AgentBrowserTabBinding;
    } = {},
  ): string[] {
    const args = ["--json", "--session", sessionId];
    const environment = this.options.environment ?? process.env;
    const headed = options.headed ?? this.options.configuration.runtime.headed;
    assertAgentBrowserWindowModeSupported({ headed, environment });
    const executable = this.browserExecutable();
    if (executable) args.push("--executable-path", executable);
    if (headed) args.push("--headed");
    args.push(
      "--idle-timeout",
      String(options.idleTimeoutMs ?? this.options.configuration.runtime.idleTimeoutMs),
      "--max-output",
      String(this.options.configuration.runtime.outputMaxChars),
      options.tabBinding === "unpin" ? "--no-pin-tab" : "--pin-tab",
    );
    if (environment.SENERA_CONTAINER === "1") {
      args.push("--args", `--disable-dev-shm-usage${process.getuid?.() === 0 ? ",--no-sandbox" : ""}`);
    }
    return args;
  }

  private connectionArguments(sessionId: string, cdpUrl: string, tabBinding: AgentBrowserTabBinding = "pin"): string[] {
    return [
      "--json",
      "--session",
      sessionId,
      "--cdp",
      cdpUrl,
      "--idle-timeout",
      String(this.options.configuration.runtime.idleTimeoutMs),
      "--max-output",
      String(this.options.configuration.runtime.outputMaxChars),
      tabBinding === "unpin" ? "--no-pin-tab" : "--pin-tab",
    ];
  }

  private async managedProfileLease(
    options: AgentBrowserDriverOperationOptions,
  ): Promise<AgentManagedBrowserProfileLease> {
    const pending =
      this.managedProfile ??
      acquireAgentManagedBrowserProfile({
        profileDirectory: this.managedProfileDirectory(),
        launchIdentity: this.managedProfileLaunchIdentity(),
        probe: this.options.probeCdpEndpoint ?? probeAgentBrowserCdpEndpoint,
        open: async () => {
          const ownerSessionId = managedBrowserOwnerSessionId(this.managedProfileDirectory());
          const launch = [
            // The profile host stays alive while Senera holds it. Child sessions
            // can come and go without invalidating the host's private CDP endpoint.
            ...this.launchArguments(ownerSessionId, { idleTimeoutMs: 0 }),
            "--profile",
            this.managedProfileDirectory(),
            "open",
            "about:blank",
          ];
          await fs.mkdir(this.managedProfileDirectory(), { recursive: true });
          await this.executeCommand(launch, options);
          const endpoint = await this.executeCommand(
            [
              ...this.launchArguments(ownerSessionId, { idleTimeoutMs: 0 }),
              "--profile",
              this.managedProfileDirectory(),
              "get",
              "cdp-url",
            ],
            options,
          );
          return readBrowserCdpUrl(endpoint);
        },
        close: async () => {
          const ownerSessionId = managedBrowserOwnerSessionId(this.managedProfileDirectory());
          await this.executeCommand(
            [
              ...this.launchArguments(ownerSessionId, { idleTimeoutMs: 0 }),
              "--profile",
              this.managedProfileDirectory(),
              "close",
            ],
            { timeoutMs: this.options.configuration.runtime.requestTimeoutMs },
          );
        },
      });
    this.managedProfile = pending;
    try {
      return await pending;
    } catch (error) {
      if (this.managedProfile === pending) this.managedProfile = undefined;
      throw error;
    }
  }

  private managedProfileDirectory(): string {
    const root = this.options.browserProfilesRoot;
    if (!root) throw new Error("The host did not provide a Senera browser profile root.");
    return path.join(path.resolve(root), ManagedBrowserProfileDirectoryName);
  }

  private managedProfileLaunchIdentity(): string {
    const environment = this.options.environment ?? process.env;
    return JSON.stringify({
      controller: this.controller(),
      browser: this.options.configuration.runtime.browser,
      executable: this.browserExecutable() ?? null,
      headed: this.options.configuration.runtime.headed,
      requestTimeoutMs: this.options.configuration.runtime.requestTimeoutMs,
      container: environment.SENERA_CONTAINER === "1",
    });
  }

  private browserExecutable(): string | undefined {
    if (!this.browserExecutableResolved) {
      this.browserExecutablePath =
        this.options.resolveExecutable?.() ??
        resolveAgentBrowserExecutableSelection({
          selection: this.options.configuration.runtime.browser,
          configuredPath: this.options.configuration.runtime.executablePath,
          workspaceRoot: this.options.workspaceRoot,
          environment: this.options.environment,
        });
      this.browserExecutableResolved = true;
    }
    return this.browserExecutablePath;
  }
}

class AgentNativeBrowserSession implements AgentBrowserDriverSession {
  private readonly tempDirectoryPromise = fs.mkdtemp(path.join(os.tmpdir(), "senera-agent-browser-"));
  private readonly ownedTabTargetIds = new Set<string>();
  private closed = false;
  private currentPersistentTabTargetId: string | undefined;
  private persistentTabInitialized = false;
  private lastKnownUrl: string | undefined;

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
    return withAgentBrowserOperationDeadline(options, (bounded) =>
      this.executeWithinDeadline(operation, input, bounded),
    );
  }

  private async executeWithinDeadline(
    operation: AgentBrowserOperation,
    input: Readonly<Record<string, unknown>>,
    options: AgentBrowserDriverOperationOptions,
  ): Promise<AgentBrowserDriverOperationResult> {
    if (this.closed) throw new Error("The controlled browser session is closed.");
    try {
      if (operation !== "close") {
        if (await this.driver.preparePersistentSession(this.options.sessionId, options))
          await this.rebindSessionTab(options);
        await this.ensurePersistentTab(options);
      }
      return await this.completeOperation(operation, input, options);
    } catch (error) {
      if (operation === "close" || !isBrowserTabGoneFailure(error)) throw error;
      await this.rebindSessionTab(options);
      if (operation !== "open" && operation !== "tab_new") {
        throw new AgentNativeBrowserCommandError(
          "The browser tab bound to this session closed. The session now points at a fresh tab; open the page again to continue.",
          "tab_gone",
        );
      }
      return this.completeOperation(operation, input, options);
    }
  }

  private async completeOperation(
    operation: AgentBrowserOperation,
    input: Readonly<Record<string, unknown>>,
    options: AgentBrowserDriverOperationOptions,
  ): Promise<AgentBrowserDriverOperationResult> {
    const result = await this.executeOperation(operation, input, options);
    if (operation === "close" || operation === "tab_list" || operation === "read" || operation === "render_html")
      return result;
    // The URL is already confirmed for a recovered navigation. Querying the
    // page again would turn a usable in-flight navigation back into a failure.
    if (result.navigation?.status === "pending") return result;
    if (operation === "tab_close" && !result.page) return result;
    if (result.screenshot && result.page) {
      this.lastKnownUrl = result.page.url;
      return result;
    }
    return { ...result, page: await this.pageState(options) };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.closeOwnedPersistentTabs();
      try {
        await this.driver.run(this.options.sessionId, ["close"], { timeoutMs: this.options.requestTimeoutMs });
      } catch (error) {
        if (!isBrowserDaemonResponseLoss(error)) throw error;
      }
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
        const navigation = await this.runNavigationWithRecovery(["open", url], options, {
          targetUrl: url,
          previousUrl: this.lastKnownUrl,
        });
        this.rememberOwnedTab(navigation.data, false, true);
        return this.navigationOperationResult(navigation, pageDescription);
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
      case "click": {
        const data =
          input.newTab === true && this.options.context === "persistent"
            ? await this.openClickedTab(input, options)
            : await this.run(clickArguments(input), options);
        return { content: stringValue(data, "clicked") };
      }
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
      case "wait_ms": {
        const ms = Math.max(0, Math.floor(optionalNumber(input, "ms") ?? 0));
        await this.waitLocally(ms, options);
        return { content: `Waited ${ms}ms.` };
      }
      case "wait_for_selector":
        return {
          content: stringValue(
            await this.waitForCondition(["wait", requiredString(input, "selector")], options),
            "waited",
          ),
        };
      case "wait_for_text":
        return {
          content: stringValue(
            await this.waitForCondition(["wait", "--text", requiredString(input, "text")], options),
            "waited",
          ),
        };
      case "wait_for_load":
        return {
          content: stringValue(
            await this.waitForCondition(["wait", "--load", requiredString(input, "state")], options),
            "waited",
          ),
        };
      case "wait_for_url":
        return {
          content: stringValue(
            await this.waitForCondition(["wait", "--url", requiredString(input, "urlPattern")], options),
            "waited",
          ),
        };
      case "wait_for_function":
        return {
          content: stringValue(
            await this.waitForCondition(["wait", "--fn", requiredString(input, "expression")], options),
            "waited",
          ),
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
      case "forward": {
        const previousUrl = this.lastKnownUrl;
        const navigation = await this.runNavigationWithRecovery([operation], options, { previousUrl });
        return this.navigationOperationResult(navigation, (data) => stringValue(data, operation));
      }
      case "reload":
        return this.reloadPage(options);
      case "tab_new": {
        const args = ["tab", "new"];
        const label = optionalString(input, "label");
        if (label) args.push("--label", label);
        const url = optionalString(input, "url");
        if (url) {
          await this.options.assertRequestPermitted(url, "navigation");
          args.push(url);
        }
        const navigation = await this.driver.withPersistentTabMutation(this.options.sessionId, async () => {
          const before =
            this.options.context === "persistent"
              ? new Set((await this.listBrowserTabs(options)).map((tab) => tab.targetId))
              : undefined;
          const created = url
            ? await this.runNavigationWithRecovery(args, options, { targetUrl: url, previousUrl: this.lastKnownUrl })
            : { data: await this.run(args, options), pending: false };
          if (created.pending) {
            const createdTargetId = await this.recoverOpenedTabTargetId(before, options);
            if (createdTargetId) {
              this.ownedTabTargetIds.add(createdTargetId);
              this.currentPersistentTabTargetId = createdTargetId;
            }
          } else {
            this.rememberOwnedTab(created.data, false, true);
          }
          return created;
        });
        return this.navigationOperationResult(navigation, (data) => stringValue(data, "tab"));
      }
      case "tab_list": {
        const tabs = await this.listAccessibleTabs(options);
        return { content: tabListContent({ tabs }) };
      }
      case "tab_switch": {
        const tab = await this.resolveOwnedTab(requiredString(input, "tab"), options);
        const data = await this.run(["tab", tab.targetId], options);
        this.currentPersistentTabTargetId = tab.targetId;
        return { content: stringValue(data, "tab") };
      }
      case "tab_close": {
        const tab = optionalString(input, "tab");
        const target = tab ? await this.resolveOwnedTab(tab, options) : undefined;
        const data = await this.run(target ? ["tab", "close", target.targetId] : ["tab", "close"], options);
        const closedTargetId = target?.targetId ?? this.currentPersistentTabTargetId;
        if (closedTargetId) this.ownedTabTargetIds.delete(closedTargetId);
        if (!target || target.targetId === this.currentPersistentTabTargetId)
          this.currentPersistentTabTargetId = undefined;
        return { content: stringValue(data, "tab") };
      }
      case "download":
        return this.download(input, options);
      case "computer":
        return this.computer(input, options);
    }
  }

  private async rebindSessionTab(options: AgentBrowserDriverOperationOptions): Promise<void> {
    // The daemon still pins a tab that no longer exists. `tab new` alone leaves
    // that stale strict pin in place, so clear the pin in the same command or
    // every later operation keeps failing with tab_gone.
    const data = await this.runUnpinned(["tab", "new", "about:blank"], options);
    this.ownedTabTargetIds.clear();
    this.currentPersistentTabTargetId = undefined;
    this.persistentTabInitialized = true;
    this.rememberOwnedTab(data, false, true);
  }

  private async ensurePersistentTab(options: AgentBrowserDriverOperationOptions): Promise<void> {
    if (this.options.context !== "persistent" || this.persistentTabInitialized) return;
    await this.driver.withPersistentTabMutation(this.options.sessionId, async () => {
      if (this.persistentTabInitialized) return;
      const data = await this.run(["open", "about:blank"], options);
      this.rememberOwnedTab(data, true, true);
      this.persistentTabInitialized = true;
    });
  }

  private async openClickedTab(
    input: Readonly<Record<string, unknown>>,
    options: AgentBrowserDriverOperationOptions,
  ): Promise<unknown> {
    return this.driver.withPersistentTabMutation(this.options.sessionId, async () => {
      const before = new Set((await this.listBrowserTabs(options)).map((tab) => tab.targetId));
      const data = await this.run(clickArguments(input), options);
      const targetId = browserTargetId(data) ?? onlyNewBrowserTabTarget(before, await this.listBrowserTabs(options));
      if (!targetId) throw new Error("The controlled browser did not identify the tab opened by this click.");
      this.ownedTabTargetIds.add(targetId);
      this.currentPersistentTabTargetId = targetId;
      return data;
    });
  }

  private rememberOwnedTab(value: unknown, required = false, current = false): void {
    if (this.options.context !== "persistent") return;
    const targetId = browserTargetId(value);
    if (!targetId) {
      if (required) throw new Error("The controlled browser did not identify the session tab.");
      return;
    }
    this.ownedTabTargetIds.add(targetId);
    if (current) this.currentPersistentTabTargetId = targetId;
  }

  private async listAccessibleTabs(options: AgentBrowserDriverOperationOptions): Promise<readonly AgentBrowserTab[]> {
    const tabs = await this.listBrowserTabs(options);
    if (this.options.context !== "persistent") return tabs;
    const available = new Set(tabs.map((tab) => tab.targetId));
    for (const targetId of this.ownedTabTargetIds) {
      if (!available.has(targetId)) this.ownedTabTargetIds.delete(targetId);
    }
    return tabs.filter((tab) => this.ownedTabTargetIds.has(tab.targetId));
  }

  private async resolveOwnedTab(
    reference: string,
    options: AgentBrowserDriverOperationOptions,
  ): Promise<AgentBrowserTab> {
    const tab = (await this.listAccessibleTabs(options)).find((candidate) => browserTabMatches(candidate, reference));
    if (!tab) throw new Error("The requested browser tab is not owned by this controlled browser session.");
    return tab;
  }

  private async listBrowserTabs(options: AgentBrowserDriverOperationOptions): Promise<readonly AgentBrowserTab[]> {
    return browserTabs(await this.run(["tab", "list"], options));
  }

  private async closeOwnedPersistentTabs(): Promise<void> {
    if (this.options.context !== "persistent" || this.ownedTabTargetIds.size === 0) return;
    const targets = [...this.ownedTabTargetIds];
    const currentIndex = this.currentPersistentTabTargetId ? targets.indexOf(this.currentPersistentTabTargetId) : -1;
    if (currentIndex >= 0) {
      const [current] = targets.splice(currentIndex, 1);
      if (current) targets.push(current);
    }
    await this.driver.withPersistentTabMutation(this.options.sessionId, async () => {
      // A page can close itself while a session is winding down. Cleanup must
      // continue with the remaining owned tabs and still release the daemon.
      for (const targetId of targets) {
        await this.run(["tab", "close", targetId], { timeoutMs: this.options.requestTimeoutMs }).catch(() => undefined);
      }
      this.ownedTabTargetIds.clear();
      this.currentPersistentTabTargetId = undefined;
    });
  }

  private async renderHtml(
    input: Readonly<Record<string, unknown>>,
    options: AgentBrowserDriverOperationOptions,
  ): Promise<AgentBrowserDriverOperationResult> {
    const renderOptions = { ...options, headed: false };
    const operationDeadline = Date.now() + renderOptions.timeoutMs;
    const url = requiredString(input, "url");
    await this.options.assertRequestPermitted(url, "navigation");
    const { data: opened } = await this.runNavigationWithRecovery(["open", url], renderOptions, {
      targetUrl: url,
      previousUrl: this.lastKnownUrl,
    });
    const settleTimeoutMs = requiredPositiveNumber(input, "settleTimeoutMs");
    const pollMs = requiredPositiveNumber(input, "settlePollMs");
    const stableSamples = requiredPositiveInteger(input, "stableSamples");
    const deadline = Math.min(operationDeadline, Date.now() + settleTimeoutMs);
    await waitForBrowserDelay(Math.min(pollMs, Math.max(1, deadline - Date.now())), renderOptions.signal);
    let html = await this.readHtml(renderOptions, deadline);
    let signature = renderedHtmlSignature(html);
    let stable = 1;
    while (stable < stableSamples && Date.now() < deadline) {
      await waitForBrowserDelay(Math.min(pollMs, Math.max(1, deadline - Date.now())), renderOptions.signal);
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
    this.lastKnownUrl = url;
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

  /**
   * Native navigation has an internal load timeout. The page can keep loading, so recover
   * the pending navigation from page state instead of resending the command.
   */
  private async runNavigationWithRecovery(
    args: readonly string[],
    options: AgentBrowserDriverOperationOptions,
    expectation: { readonly targetUrl?: string; readonly previousUrl?: string },
  ): Promise<AgentBrowserNavigationOutcome> {
    const deadline = Date.now() + options.timeoutMs;
    try {
      return {
        data: await this.run(args, options),
        pending: false,
      };
    } catch (error) {
      if (!isUncertainBrowserNavigation(error)) throw error;
      if (Date.now() >= deadline) throw navigationBudgetError();
      return {
        data: await this.settlePendingNavigation(options, deadline, expectation),
        pending: true,
      };
    }
  }

  private async settlePendingNavigation(
    options: AgentBrowserDriverOperationOptions,
    deadline: number,
    expectation: { readonly targetUrl?: string; readonly previousUrl?: string },
  ): Promise<{ url: string; title: string }> {
    const previousUrl = expectation.previousUrl ?? "about:blank";
    while (Date.now() < deadline) {
      let currentUrl: string;
      try {
        currentUrl = stringValue(await this.runWithRemaining(["get", "url"], options, deadline), "url");
      } catch (error) {
        if (Date.now() >= deadline) break;
        if (!isRetryableBrowserReadFailure(error) || options.signal?.aborted) throw error;
        await this.waitDuringNavigation(deadline, options.signal);
        continue;
      }
      if (browserNavigationCommitted(currentUrl, expectation.targetUrl, previousUrl)) {
        this.lastKnownUrl = currentUrl;
        return this.observedPageState(options, deadline, currentUrl);
      }
      await this.waitDuringNavigation(deadline, options.signal);
    }
    throw navigationBudgetError();
  }

  private async reloadPage(options: AgentBrowserDriverOperationOptions): Promise<AgentBrowserDriverOperationResult> {
    const deadline = Date.now() + options.timeoutMs;
    const marker = await this.readPerformanceTimeOrigin(options, deadline);
    try {
      return {
        content: stringValue(await this.run(["reload"], options), "reload"),
      };
    } catch (error) {
      if (!isUncertainBrowserNavigation(error) || marker === undefined) throw error;
      const settled = await this.settlePendingReload(options, deadline, marker);
      return {
        content: pendingNavigationContent(settled.url),
        page: settled,
        navigation: { status: "pending" },
      };
    }
  }

  private async settlePendingReload(
    options: AgentBrowserDriverOperationOptions,
    deadline: number,
    marker: string,
  ): Promise<{ url: string; title: string }> {
    while (Date.now() < deadline) {
      let current: string | undefined;
      try {
        current = await this.readPerformanceTimeOrigin(options, deadline);
      } catch (error) {
        if (!isRetryableBrowserReadFailure(error) || options.signal?.aborted) throw error;
      }
      if (current !== undefined && current !== marker) {
        return this.observedPageState(options, deadline, this.lastKnownUrl);
      }
      await this.waitDuringNavigation(deadline, options.signal);
    }
    throw navigationBudgetError();
  }

  private async readPerformanceTimeOrigin(
    options: AgentBrowserDriverOperationOptions,
    deadline: number,
  ): Promise<string | undefined> {
    try {
      const data = await this.runWithRemaining(["eval", "performance.timeOrigin"], options, deadline);
      const result = recordValue(data, "result");
      return typeof result === "number" || typeof result === "string" ? String(result) : undefined;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      return undefined;
    }
  }

  /**
   * The URL is the authoritative signal that a navigation was submitted.
   * Title is ancillary metadata, so a transient read failure must not undo a
   * confirmed navigation or cause an unsafe second navigation attempt.
   */
  private async observedPageState(
    options: AgentBrowserDriverOperationOptions,
    deadline: number,
    knownUrl: string | undefined,
  ): Promise<{ url: string; title: string }> {
    const url = knownUrl ?? stringValue(await this.runWithRemaining(["get", "url"], options, deadline), "url");
    this.lastKnownUrl = url;
    try {
      const title = stringValue(await this.runWithRemaining(["get", "title"], options, deadline), "title");
      return { url, title };
    } catch (error) {
      if (!isRetryableBrowserReadFailure(error) || options.signal?.aborted) throw error;
      return { url, title: "" };
    }
  }

  private navigationOperationResult(
    navigation: AgentBrowserNavigationOutcome,
    settledContent: (data: unknown) => string,
  ): AgentBrowserDriverOperationResult {
    const page = pageFromData(navigation.data);
    if (!navigation.pending) {
      return { content: settledContent(navigation.data), ...(page ? { page } : {}) };
    }
    return {
      content: pendingNavigationContent(page?.url),
      ...(page ? { page } : {}),
      navigation: { status: "pending" },
    };
  }

  private async waitForCondition(
    args: readonly string[],
    options: AgentBrowserDriverOperationOptions,
  ): Promise<unknown> {
    const deadline = Date.now() + options.timeoutMs;
    while (true) {
      assertBrowserOperationActive(options.signal);
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new AgentNativeBrowserCommandError(
          `The browser wait expired after ${options.timeoutMs}ms without observing its condition.`,
          "timeout",
        );
      }
      try {
        return await this.run(args, options);
      } catch (error) {
        if (!isRetryableBrowserWaitFailure(error) || options.signal?.aborted) throw error;
        await waitForBrowserDelay(
          Math.min(AgentBrowserNavigationPollMs, Math.max(1, deadline - Date.now())),
          options.signal,
        );
      }
    }
  }

  private async waitLocally(ms: number, options: AgentBrowserDriverOperationOptions): Promise<void> {
    const requestedMs = Math.max(0, Math.floor(ms));
    const budgetMs = Math.max(0, Math.floor(options.timeoutMs));
    await waitForBrowserDelay(Math.min(requestedMs, budgetMs), options.signal);
    if (requestedMs > budgetMs) {
      throw new AgentNativeBrowserCommandError(
        `Browser wait of ${requestedMs}ms exceeds the remaining ${budgetMs}ms operation budget. Increase the browser operation timeout in settings to wait longer.`,
        "timeout",
      );
    }
  }

  private async waitDuringNavigation(deadline: number, signal?: AbortSignal): Promise<void> {
    await waitForBrowserDelay(Math.min(AgentBrowserNavigationPollMs, Math.max(1, deadline - Date.now())), signal);
  }

  private async recoverOpenedTabTargetId(
    previousTargetIds: ReadonlySet<string> | undefined,
    options: AgentBrowserDriverOperationOptions,
  ): Promise<string | undefined> {
    if (this.options.context !== "persistent" || !previousTargetIds) return undefined;
    const tabs = await this.listBrowserTabs(options);
    return onlyNewBrowserTabTarget(previousTargetIds, tabs) ?? tabs.find((tab) => tab.active)?.targetId;
  }

  private async screenshot(
    input: Readonly<Record<string, unknown>>,
    options: AgentBrowserDriverOperationOptions,
  ): Promise<AgentBrowserDriverOperationResult> {
    const format = optionalString(input, "format") === "jpeg" ? "jpeg" : "png";
    const selector = optionalString(input, "selector");
    const selectorBox = selector ? screenshotBox(await this.run(["get", "box", selector], options)) : undefined;
    const annotations = optionalBoolean(input, "annotate")
      ? await this.screenshotAnnotations(options, selectorBox)
      : [];
    const targetId =
      this.currentPersistentTabTargetId ?? (await this.listBrowserTabs(options)).find((tab) => tab.active)?.targetId;
    if (!targetId) throw new Error("The browser did not identify this session's screenshot tab.");
    return this.driver.screenshotWithCdp(this.options.sessionId, {
      targetId,
      format,
      fullPage: input.fullPage === true,
      ...(selectorBox ? { selectorBox } : {}),
      annotations,
      options,
    });
  }

  private async screenshotAnnotations(
    options: AgentBrowserDriverOperationOptions,
    selection?: AgentBrowserScreenshotBox,
  ): Promise<readonly AgentBrowserScreenshotAnnotation[]> {
    const snapshot = await this.run(["snapshot", "-i"], options);
    const refs = recordValue(snapshot, "refs");
    if (!refs || typeof refs !== "object" || Array.isArray(refs))
      throw new Error("The browser did not return screenshot annotation references.");
    const references = Object.keys(refs).map((ref) => `@${ref}`);
    if (!references.length) return [];
    const results = await this.driver.run(
      this.options.sessionId,
      ["batch"],
      options,
      "pin",
      JSON.stringify(references.map((ref) => ["get", "box", ref])),
    );
    if (!Array.isArray(results) || results.length !== references.length)
      throw new Error("The browser returned an incomplete annotation batch.");
    return results.flatMap((result: unknown, index) => {
      if (recordValue(result, "success") !== true)
        throw new AgentNativeBrowserCommandError(
          String(recordValue(result, "error") ?? "Could not resolve the screenshot annotation."),
          typeof recordValue(result, "code") === "string" ? String(recordValue(result, "code")) : undefined,
        );
      const data = recordValue(result, "data");
      if (recordValue(data, "width") === 0 || recordValue(data, "height") === 0) return [];
      const box = screenshotBox(data);
      if (
        selection &&
        (box.x + box.width <= selection.x ||
          box.y + box.height <= selection.y ||
          box.x >= selection.x + selection.width ||
          box.y >= selection.y + selection.height)
      )
        return [];
      return [{ ref: references[index]!, box }];
    });
  }

  private async download(
    input: Readonly<Record<string, unknown>>,
    options: AgentBrowserDriverOperationOptions,
  ): Promise<AgentBrowserDriverOperationResult> {
    const root = await this.tempDirectoryPromise;
    const directory = await fs.mkdtemp(path.join(root, "download-"));
    try {
      const selector = optionalString(input, "selector");
      const url = optionalString(input, "url");
      if (Boolean(selector) === Boolean(url))
        throw new Error("BrowserDownload requires exactly one of selector or url.");
      const sourcePage = await this.currentPageUrl(options);
      const href = selector ? await this.attribute(selector, "href", options) : url;
      const sourceUrl = resolveDirectDownloadTarget(href, sourcePage);
      if (url && !sourceUrl) throw new Error("BrowserDownload url must be an HTTP, HTTPS, or authorized file URL.");
      if (sourceUrl) await this.options.assertRequestPermitted(sourceUrl, "subresource", sourcePage);
      const targetId =
        this.currentPersistentTabTargetId ?? (await this.listBrowserTabs(options)).find((tab) => tab.active)?.targetId;
      if (!targetId) throw new Error("The browser did not identify this session's active tab.");

      const downloaded = await this.driver.downloadWithCdp(
        this.options.sessionId,
        directory,
        options,
        targetId,
        this.options.maxDownloadBytes,
        selector
          ? {
              activate: async (signal) => {
                await this.run(["click", selector], { ...options, signal });
              },
            }
          : { url: sourceUrl! },
        (target) => this.options.assertRequestPermitted(target, "subresource", sourcePage),
      );
      assertBrowserDownloadPath(directory, downloaded.filePath);
      const data = await readBrowserDownload(downloaded.filePath, this.options.maxDownloadBytes);
      const detected = await fileTypeFromBuffer(data);
      const fileName = resolveDownloadFileName(downloaded.suggestedFilename, detected?.ext);
      const downloadedUrl = resolveDirectDownloadTarget(downloaded.url, sourcePage) ?? sourceUrl;
      const download: AgentBrowserDriverDownload = {
        data,
        fileName,
        ...(detected ? { mediaType: detected.mime } : {}),
        ...(downloadedUrl ? { url: downloadedUrl } : {}),
      };
      return { content: `Downloaded ${fileName}.`, download };
    } finally {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async attribute(
    selector: string,
    name: string,
    options: AgentBrowserDriverOperationOptions,
  ): Promise<string | undefined> {
    const data = await this.run(["get", "attr", selector, name], options);
    const value = recordValue(data, "value") ?? recordValue(data, "text");
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  private async currentPageUrl(options: AgentBrowserDriverOperationOptions): Promise<string> {
    return stringValue(await this.run(["get", "url"], options), "url");
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
          await this.waitLocally(action.ms, options);
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

  private async runUnpinned(args: readonly string[], options: AgentBrowserDriverOperationOptions): Promise<unknown> {
    return this.driver.run(this.options.sessionId, args, options, "unpin");
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
    this.lastKnownUrl = url;
    return { url, title };
  }
}

function assertBrowserOperationActive(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new Error("The browser operation was cancelled.");
}

function waitForBrowserDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("The browser operation was cancelled."));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("The browser operation was cancelled."));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    timer.unref();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function pendingNavigationContent(url: string | undefined): string {
  const target = url ? `The browser reached ${url}` : "The browser reached the requested page";
  return `${target}, but it may still be loading. Use BrowserWaitForLoad or wait for a specific page condition before interacting.`;
}

function resolveDirectDownloadTarget(href: string | undefined, sourcePage: string): string | undefined {
  if (!href) return undefined;
  try {
    const target = new URL(href, sourcePage);
    return target.protocol === "http:" || target.protocol === "https:" || target.protocol === "file:"
      ? target.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function resolveDownloadFileName(declaredFileName: string | undefined, detectedExtension: string | undefined): string {
  const declared = declaredFileName && path.basename(declaredFileName.replaceAll("\\", "/"));
  if (declared) return declared;
  return detectedExtension ? `download.${detectedExtension}` : "download";
}

function assertBrowserDownloadPath(directory: string, filePath: string): void {
  const relative = path.relative(path.resolve(directory), path.resolve(filePath));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("The browser reported a download file outside the controlled download directory.");
  }
}

async function readBrowserDownload(output: string, maxBytes: number): Promise<Uint8Array> {
  const file = await fs.open(output, "r");
  try {
    const details = await file.stat();
    if (details.size > maxBytes) {
      throw new Error(`Browser download exceeds the configured ${maxBytes} byte limit.`);
    }
    return await file.readFile();
  } finally {
    await file.close();
  }
}
