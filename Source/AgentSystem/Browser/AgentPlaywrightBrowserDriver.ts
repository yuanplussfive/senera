import type { Browser, BrowserContext, ElementHandle, Locator, Page } from "playwright-core";
import type {
  AgentBrowserDriver,
  AgentBrowserDriverOperationOptions,
  AgentBrowserDriverOperationResult,
  AgentBrowserDriverSession,
  AgentBrowserDriverSessionOptions,
  AgentBrowserNetworkRequestKind,
} from "./AgentBrowserDriver.js";
import type { AgentBrowserConfiguration } from "./AgentBrowserConfiguration.js";
import {
  AgentBrowserComputerActionTypes,
  type AgentBrowserComputerAction,
  type AgentBrowserOperation,
} from "./AgentBrowserTypes.js";
import {
  assertAgentBrowserWindowModeSupported,
  resolveAgentBrowserExecutable,
} from "./AgentBrowserExecutableResolver.js";
import {
  assertNotAborted,
  type BrowserTabState,
  compactSnapshot,
  isElementHandle,
  optionalBoolean,
  optionalNumber,
  optionalString,
  pageDescriptor,
  requiredString,
  requiredStringArray,
  scrollDelta,
  snapshotElementDescriptor,
  waitForDuration,
} from "./AgentPlaywrightBrowserDriverSupport.js";

const InteractiveSelector = [
  "a[href]",
  "button",
  "input:not([type='hidden'])",
  "textarea",
  "select",
  "[role='button']",
  "[role='link']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='menuitem']",
  "[role='tab']",
  "[contenteditable='true']",
].join(", ");

const MaxSnapshotReferences = 256;

export interface AgentPlaywrightBrowserDriverOptions {
  readonly workspaceRoot: string;
  readonly configuration: AgentBrowserConfiguration;
  readonly resolveExecutable?: () => string;
  readonly environment?: NodeJS.ProcessEnv;
}

/**
 * A browser-process owner. Each Senera session receives a fresh Playwright
 * context, so cookies, storage, permissions, tabs, and request routing are
 * never shared with a user profile or another agent session.
 */
export class AgentPlaywrightBrowserDriver implements AgentBrowserDriver {
  private browserPromise: Promise<Browser> | undefined;
  private launchedBrowser: Browser | undefined;
  private closed = false;
  private closePromise: Promise<void> | undefined;

  constructor(private readonly options: AgentPlaywrightBrowserDriverOptions) {}

  async createSession(options: AgentBrowserDriverSessionOptions): Promise<AgentBrowserDriverSession> {
    if (this.closed) throw new Error("The controlled browser driver is closed.");
    const browser = await this.browser();
    const context = await browser.newContext({
      acceptDownloads: true,
      ignoreHTTPSErrors: false,
      serviceWorkers: "block",
    });
    context.setDefaultTimeout(options.requestTimeoutMs);
    return AgentPlaywrightBrowserSession.open(context, options);
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    const closing = this.closeDriver().finally(() => {
      if (this.closePromise === closing) this.closePromise = undefined;
    });
    this.closePromise = closing;
    return closing;
  }

  private async browser(): Promise<Browser> {
    if (this.closed) throw new Error("The controlled browser driver is closed.");
    const environment = this.options.environment ?? process.env;
    assertAgentBrowserWindowModeSupported({ headed: this.options.configuration.runtime.headed, environment });
    // playwright-core ships ~13MB of bundle source that V8 retains for the
    // process lifetime once loaded, so defer it until the first launch.
    const { chromium } = await import("playwright-core");
    this.browserPromise ??= chromium
      .launch({
        executablePath:
          this.options.resolveExecutable?.() ??
          resolveAgentBrowserExecutable({
            configuredPath: this.options.configuration.runtime.executablePath,
            workspaceRoot: this.options.workspaceRoot,
          }),
        headless: !this.options.configuration.runtime.headed,
        timeout: this.options.configuration.runtime.requestTimeoutMs,
        // Docker's default shared-memory mount is intentionally small, and the
        // single-service root mode must disable Chromium's sandbox to launch at
        // all. The multi-service deployment keeps both flags absent so the
        // browser runs fully sandboxed as the node user.
        ...(environment.SENERA_CONTAINER === "1"
          ? { args: ["--disable-dev-shm-usage", ...(isContainerRoot() ? ["--no-sandbox"] : [])] }
          : {}),
      })
      .then(async (browser) => {
        if (this.closed) {
          await browser.close();
          throw new Error("The controlled browser driver was closed while starting.");
        }
        this.launchedBrowser = browser;
        return browser;
      });
    return this.browserPromise;
  }

  private async closeDriver(): Promise<void> {
    if (this.launchedBrowser) {
      await this.launchedBrowser.close();
      return;
    }
    // BrowserType.launch has no AbortSignal. Do not let an in-progress launch
    // delay task cancellation; close it as soon as it resolves instead.
    void this.browserPromise?.then((browser) => browser.close()).catch(() => undefined);
  }
}

class AgentPlaywrightBrowserSession implements AgentBrowserDriverSession {
  private readonly tabs = new Map<Page, BrowserTabState>();
  private readonly references = new Map<string, ElementHandle<Node>>();
  private activePage: Page | undefined;
  private nextTabId = 1;
  private nextReferenceId = 1;
  private closed = false;
  private navigationFailure: unknown;

  private constructor(
    private readonly context: BrowserContext,
    private readonly options: AgentBrowserDriverSessionOptions,
  ) {}

  static async open(
    context: BrowserContext,
    options: AgentBrowserDriverSessionOptions,
  ): Promise<AgentPlaywrightBrowserSession> {
    const session = new AgentPlaywrightBrowserSession(context, options);
    await context.route("**/*", async (route, request) => {
      const url = request.url();
      const kind: AgentBrowserNetworkRequestKind = request.isNavigationRequest() ? "navigation" : "subresource";
      try {
        await options.assertRequestPermitted(url, kind);
        await route.continue();
      } catch (error) {
        if (kind === "navigation") session.navigationFailure = error;
        await route.abort("blockedbyclient");
      }
    });
    context.on("page", (page) => session.trackPage(page));
    for (const page of context.pages()) session.trackPage(page);
    return session;
  }

  async execute(
    operation: AgentBrowserOperation,
    input: Readonly<Record<string, unknown>>,
    options: AgentBrowserDriverOperationOptions,
  ): Promise<AgentBrowserDriverOperationResult> {
    if (this.closed) throw new Error("The controlled browser session is closed.");
    const timeoutMs = options.timeoutMs;
    return this.withAbort(options.signal, async () => {
      const result = await (async (): Promise<AgentBrowserDriverOperationResult> => {
        switch (operation) {
          case "open":
            return this.open(requiredString(input, "url"), timeoutMs, options.signal);
          case "read":
            return this.read(optionalString(input, "url"), timeoutMs, options.signal);
          case "snapshot":
            return this.snapshot(input, timeoutMs, options.signal);
          case "click":
            return this.click(
              requiredString(input, "selector"),
              optionalBoolean(input, "newTab") ?? false,
              timeoutMs,
              options.signal,
            );
          case "fill":
            return this.fill(
              requiredString(input, "selector"),
              requiredString(input, "text"),
              timeoutMs,
              options.signal,
            );
          case "type":
            return this.type(
              requiredString(input, "selector"),
              requiredString(input, "text"),
              optionalBoolean(input, "clear") ?? false,
              optionalNumber(input, "delayMs"),
              timeoutMs,
              options.signal,
            );
          case "press":
            return this.press(requiredStringArray(input, "keys"));
          case "check":
            return this.check(requiredString(input, "selector"), timeoutMs, options.signal);
          case "uncheck":
            return this.uncheck(requiredString(input, "selector"), timeoutMs, options.signal);
          case "select":
            return this.select(
              requiredString(input, "selector"),
              requiredStringArray(input, "values"),
              timeoutMs,
              options.signal,
            );
          case "scroll":
            return this.scroll(input, timeoutMs, options.signal);
          case "wait_ms":
            return this.wait(optionalNumber(input, "ms") ?? 0, options.signal);
          case "wait_for_selector":
            return this.waitForSelector(requiredString(input, "selector"), timeoutMs, options.signal);
          case "wait_for_text":
            return this.waitForText(requiredString(input, "text"), timeoutMs, options.signal);
          case "wait_for_load":
            return this.waitForLoad(requiredString(input, "state"), timeoutMs, options.signal);
          case "screenshot":
            return this.screenshot(input, timeoutMs, options.signal);
          case "get_text":
            return this.getText(requiredString(input, "selector"), timeoutMs, options.signal);
          case "get_url":
            return { content: this.page().url() };
          case "get_title":
            return { content: await this.page().title() };
          case "close":
            await this.close();
            return { content: "Controlled browser session closed." };
          case "back":
            return this.back(timeoutMs, options.signal);
          case "forward":
            return this.forward(timeoutMs, options.signal);
          case "reload":
            return this.reload(timeoutMs, options.signal);
          case "tab_new":
            return this.newTab(optionalString(input, "url"), optionalString(input, "label"), timeoutMs, options.signal);
          case "tab_list":
            return this.listTabs();
          case "tab_switch":
            return this.switchTab(requiredString(input, "tab"));
          case "tab_close":
            return this.closeTab(optionalString(input, "tab"));
          case "download":
            return this.download(requiredString(input, "selector"), timeoutMs, options.signal);
          case "computer":
            return this.computer(input, timeoutMs, options.signal);
        }
      })();
      if (invalidatesBrowserSnapshotReferences(operation, input)) await this.clearReferences();
      if (operation === "close" || operation === "tab_list") return result;
      if (operation === "tab_close" && this.livePages().length === 0) return result;
      return { ...result, page: await this.pageState() };
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.clearReferences();
    await this.context.close();
  }

  private async open(url: string, timeoutMs: number, signal?: AbortSignal): Promise<AgentBrowserDriverOperationResult> {
    const page = await this.pageOrCreate();
    await this.navigate(page, url, timeoutMs, signal);
    return { content: await pageDescriptor(page) };
  }

  private async read(
    url: string | undefined,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentBrowserDriverOperationResult> {
    const page = url ? await this.pageOrCreate() : this.page();
    if (url) await this.navigate(page, url, timeoutMs, signal);
    return { content: await page.locator("body").innerText({ timeout: timeoutMs, signal }) };
  }

  private async snapshot(
    input: Readonly<Record<string, unknown>>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentBrowserDriverOperationResult> {
    const page = this.page();
    const selector = optionalString(input, "selector");
    const root = selector ? this.snapshotLocator(selector) : page.locator("body");
    const interactive = optionalBoolean(input, "interactive") ?? true;
    const compact = optionalBoolean(input, "compact") ?? true;
    const includeUrls = optionalBoolean(input, "includeUrls") ?? false;
    const depth = optionalNumber(input, "depth");
    const accessibility = await root.ariaSnapshot({
      mode: "default",
      ...(depth === undefined ? {} : { depth }),
      timeout: timeoutMs,
      signal,
    });
    if (!interactive) return { content: compactSnapshot(accessibility, compact) };

    await this.clearReferences();
    const handles = await root.locator(InteractiveSelector).elementHandles();
    const lines: string[] = [];
    for (const handle of handles) {
      if (lines.length >= MaxSnapshotReferences) {
        await handle.dispose().catch(() => undefined);
        continue;
      }
      const descriptor = await snapshotElementDescriptor(handle, includeUrls);
      if (!descriptor) {
        await handle.dispose().catch(() => undefined);
        continue;
      }
      const reference = `@e${this.nextReferenceId++}`;
      this.references.set(reference, handle);
      lines.push(`${reference} ${descriptor}`);
    }
    const references =
      lines.length > 0 ? `Interactive elements:\n${lines.join("\n")}` : "No visible interactive elements.";
    const hierarchy = compactSnapshot(accessibility, compact);
    return { content: hierarchy ? `${references}\n\nAccessibility:\n${hierarchy}` : references };
  }

  private async click(
    selector: string,
    newTab: boolean,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentBrowserDriverOperationResult> {
    const page = this.page();
    const target = this.locator(selector);
    const popup = newTab ? page.waitForEvent("popup", { timeout: timeoutMs }).catch(() => undefined) : undefined;
    await target.click({
      timeout: timeoutMs,
      signal,
      ...(newTab ? { modifiers: [process.platform === "darwin" ? "Meta" : "Control"] } : {}),
    });
    const popupPage = await popup;
    if (popupPage) {
      this.trackPage(popupPage);
      this.activePage = popupPage;
    }
    this.throwNavigationFailure();
    return {
      content: popupPage
        ? `Opened ${this.tabId(popupPage)}.\n${await pageDescriptor(popupPage)}`
        : "Activated browser element.",
    };
  }

  private async download(
    selector: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentBrowserDriverOperationResult> {
    const page = this.page();
    const downloadPromise = page.waitForEvent("download", { timeout: timeoutMs });
    void downloadPromise.catch(() => undefined);
    await this.locator(selector).click({ timeout: timeoutMs, signal });
    const download = await downloadPromise;
    const failure = await download.failure();
    if (failure) throw new Error(`Browser download failed: ${failure}`);
    const stream = await download.createReadStream();
    if (!stream) throw new Error("Browser download did not provide a readable stream.");
    const data = await readDownloadStream(stream, this.options.maxDownloadBytes, signal);
    return {
      content: `Downloaded ${download.suggestedFilename()}.`,
      download: {
        data,
        fileName: download.suggestedFilename(),
        url: download.url(),
      },
    };
  }

  private async computer(
    input: Readonly<Record<string, unknown>>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentBrowserDriverOperationResult> {
    const actions = requiredComputerActions(input);
    for (const action of actions) {
      await this.executeComputerAction(action, signal);
      if (action.type !== "screenshot") await this.clearReferences();
    }
    this.throwNavigationFailure();
    return {
      content: await pageDescriptor(this.page()),
      ...(await this.capturePageScreenshot(timeoutMs, signal)),
    };
  }

  private async executeComputerAction(action: AgentBrowserComputerAction, signal?: AbortSignal): Promise<void> {
    const page = this.page();
    switch (action.type) {
      case "click":
      case "double_click":
        await withBrowserModifiers(page, action.modifiers, async () => {
          if (action.type === "double_click") {
            await page.mouse.dblclick(action.x, action.y, { button: action.button ?? "left", delay: 0 });
          } else {
            await page.mouse.click(action.x, action.y, { button: action.button ?? "left", clickCount: 1 });
          }
        });
        return;
      case "move":
        await withBrowserModifiers(page, action.modifiers, () => page.mouse.move(action.x, action.y));
        return;
      case "scroll":
        await withBrowserModifiers(page, action.modifiers, async () => {
          await page.mouse.move(action.x, action.y);
          await page.mouse.wheel(action.scrollX ?? 0, action.scrollY ?? 0);
        });
        return;
      case "drag":
        await withBrowserModifiers(page, action.modifiers, async () => {
          const first = action.path[0];
          if (!first) throw new Error("Browser drag requires at least one point.");
          await page.mouse.move(first.x, first.y);
          await page.mouse.down();
          try {
            for (const point of action.path.slice(1)) await page.mouse.move(point.x, point.y);
          } finally {
            await page.mouse.up();
          }
        });
        return;
      case "type":
        await page.keyboard.type(action.text);
        return;
      case "keypress":
        await page.keyboard.press(action.keys.map(normalizeBrowserKey).join("+"));
        return;
      case "wait":
        await waitForDuration(action.ms, signal);
        return;
      case "screenshot":
        return;
    }
  }

  private async capturePageScreenshot(
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Pick<AgentBrowserDriverOperationResult, "screenshot">> {
    const data = await this.page().screenshot({ type: "png", timeout: timeoutMs, animations: "disabled" });
    assertNotAborted(signal);
    return { screenshot: { data, mediaType: "image/png" } };
  }

  private async fill(
    selector: string,
    text: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentBrowserDriverOperationResult> {
    await this.locator(selector).fill(text, { timeout: timeoutMs, signal });
    return { content: "Filled browser input." };
  }

  private async type(
    selector: string,
    text: string,
    clear: boolean,
    delayMs: number | undefined,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentBrowserDriverOperationResult> {
    const target = this.locator(selector);
    if (clear) await target.fill("", { timeout: timeoutMs, signal });
    if (isElementHandle(target)) {
      await target.type(text, delayMs === undefined ? undefined : { delay: delayMs });
    } else {
      await target.pressSequentially(text, {
        ...(delayMs === undefined ? {} : { delay: delayMs }),
        timeout: timeoutMs,
        signal,
      });
    }
    return { content: "Typed into browser element." };
  }

  private async press(keys: readonly string[]): Promise<AgentBrowserDriverOperationResult> {
    const key = keys.map(normalizeBrowserKey).join("+");
    await this.page().keyboard.press(key);
    this.throwNavigationFailure();
    return { content: `Pressed ${key}.` };
  }

  private async check(
    selector: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentBrowserDriverOperationResult> {
    await this.locator(selector).check({ timeout: timeoutMs, signal });
    return { content: "Checked browser control." };
  }

  private async uncheck(
    selector: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentBrowserDriverOperationResult> {
    await this.locator(selector).uncheck({ timeout: timeoutMs, signal });
    return { content: "Unchecked browser control." };
  }

  private async select(
    selector: string,
    values: string[],
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentBrowserDriverOperationResult> {
    const selected = await this.locator(selector).selectOption(values, { timeout: timeoutMs, signal });
    return { content: `Selected: ${selected.join(", ") || "none"}.` };
  }

  private async scroll(
    input: Readonly<Record<string, unknown>>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentBrowserDriverOperationResult> {
    const direction = optionalString(input, "direction") ?? "down";
    const amount = optionalNumber(input, "amount") ?? 600;
    const delta = scrollDelta(direction, amount);
    const selector = optionalString(input, "selector");
    if (selector) {
      const target = this.locator(selector);
      if (isElementHandle(target)) {
        await target.evaluate(
          (element, value: { readonly left: number; readonly top: number }) =>
            (element as HTMLElement).scrollBy(value.left, value.top),
          delta,
        );
      } else {
        await target.evaluate((element, value) => element.scrollBy(value.left, value.top), delta);
      }
    } else {
      await this.page().evaluate((value) => window.scrollBy(value.left, value.top), delta);
    }
    assertNotAborted(signal);
    await this.page().waitForTimeout(Math.min(100, timeoutMs));
    return { content: "Scrolled browser content." };
  }

  private async wait(ms: number, signal?: AbortSignal): Promise<AgentBrowserDriverOperationResult> {
    await waitForDuration(ms, signal);
    return { content: `Waited ${ms} ms.` };
  }

  private async waitForSelector(
    selector: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentBrowserDriverOperationResult> {
    const target = this.locator(selector);
    if (isElementHandle(target)) {
      await target.waitForElementState("visible", { timeout: timeoutMs });
    } else {
      await target.waitFor({ state: "visible", timeout: timeoutMs, signal });
    }
    return { content: "Browser element is visible." };
  }

  private async waitForText(
    text: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentBrowserDriverOperationResult> {
    await this.page()
      .getByText(text, { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: timeoutMs, signal });
    return { content: "Browser text is visible." };
  }

  private async waitForLoad(
    state: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentBrowserDriverOperationResult> {
    if (state !== "domcontentloaded" && state !== "load" && state !== "networkidle") {
      throw new Error(`Unsupported browser load state: ${state}.`);
    }
    this.navigationFailure = undefined;
    await this.page().waitForLoadState(state, { timeout: timeoutMs, signal });
    this.throwNavigationFailure();
    return { content: `Browser reached ${state}.` };
  }

  private async screenshot(
    input: Readonly<Record<string, unknown>>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentBrowserDriverOperationResult> {
    const format = optionalString(input, "format") === "jpeg" ? "jpeg" : "png";
    const annotate = optionalBoolean(input, "annotate") ?? false;
    const page = this.page();
    const removeAnnotations = annotate ? await this.addReferenceAnnotations(page) : undefined;
    try {
      const selector = optionalString(input, "selector");
      const data = selector
        ? await this.locator(selector).screenshot({ type: format, timeout: timeoutMs, signal })
        : await page.screenshot({
            type: format,
            fullPage: optionalBoolean(input, "fullPage") ?? false,
            timeout: timeoutMs,
            animations: "disabled",
          });
      return {
        content: "Captured browser screenshot.",
        screenshot: { data, mediaType: format === "jpeg" ? "image/jpeg" : "image/png" },
      };
    } finally {
      await removeAnnotations?.();
    }
  }

  private async getText(
    selector: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentBrowserDriverOperationResult> {
    return { content: await this.locator(selector).innerText({ timeout: timeoutMs, signal }) };
  }

  private async back(timeoutMs: number, signal?: AbortSignal): Promise<AgentBrowserDriverOperationResult> {
    this.navigationFailure = undefined;
    await this.page().goBack({ waitUntil: "domcontentloaded", timeout: timeoutMs, signal });
    this.throwNavigationFailure();
    return { content: await pageDescriptor(this.page()) };
  }

  private async forward(timeoutMs: number, signal?: AbortSignal): Promise<AgentBrowserDriverOperationResult> {
    this.navigationFailure = undefined;
    await this.page().goForward({ waitUntil: "domcontentloaded", timeout: timeoutMs, signal });
    this.throwNavigationFailure();
    return { content: await pageDescriptor(this.page()) };
  }

  private async reload(timeoutMs: number, signal?: AbortSignal): Promise<AgentBrowserDriverOperationResult> {
    this.navigationFailure = undefined;
    await this.page().reload({ waitUntil: "domcontentloaded", timeout: timeoutMs, signal });
    this.throwNavigationFailure();
    return { content: await pageDescriptor(this.page()) };
  }

  private async newTab(
    url: string | undefined,
    label: string | undefined,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentBrowserDriverOperationResult> {
    const page = await this.context.newPage();
    this.trackPage(page, label);
    this.activePage = page;
    if (url) await this.navigate(page, url, timeoutMs, signal);
    return { content: `${this.tabId(page)} opened.\n${await pageDescriptor(page)}` };
  }

  private async listTabs(): Promise<AgentBrowserDriverOperationResult> {
    const pages = this.livePages();
    if (pages.length === 0) return { content: "No controlled browser tabs are open." };
    const descriptions = await Promise.all(
      pages.map(async (page) => {
        const tab = this.tabs.get(page)!;
        const active = page === this.activePage ? "* " : "";
        const label = tab.label ? ` (${tab.label})` : "";
        return `${active}${tab.id}${label}: ${await pageDescriptor(page)}`;
      }),
    );
    return { content: descriptions.join("\n") };
  }

  private switchTab(tab: string): AgentBrowserDriverOperationResult {
    const target = this.livePages().find((page) => {
      const state = this.tabs.get(page)!;
      return state.id === tab || state.label === tab;
    });
    if (!target) throw new Error(`No controlled browser tab matches ${tab}.`);
    this.activePage = target;
    return { content: `Switched to ${this.tabId(target)}.` };
  }

  private async closeTab(tab: string | undefined): Promise<AgentBrowserDriverOperationResult> {
    const target = tab
      ? this.livePages().find((page) => {
          const state = this.tabs.get(page)!;
          return state.id === tab || state.label === tab;
        })
      : this.activePage;
    if (!target) throw new Error("No controlled browser tab is available to close.");
    const id = this.tabId(target);
    await target.close();
    this.tabs.delete(target);
    if (this.activePage === target) this.activePage = this.livePages()[0];
    return { content: `Closed ${id}.` };
  }

  private async navigate(page: Page, url: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
    this.navigationFailure = undefined;
    await this.clearReferences();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs, signal });
    } catch (error) {
      this.throwNavigationFailure();
      throw error;
    }
    this.throwNavigationFailure();
  }

  private page(): Page {
    const active = this.activePage;
    if (!active || active.isClosed()) {
      const available = this.livePages()[0];
      if (!available) throw new Error("No active browser tab. Open a public URL or create a browser tab first.");
      this.activePage = available;
      return available;
    }
    return active;
  }

  private async pageOrCreate(): Promise<Page> {
    if (this.livePages().length > 0) return this.page();
    const page = await this.context.newPage();
    this.trackPage(page);
    this.activePage = page;
    return page;
  }

  private locator(selector: string): Locator | ElementHandle<Node> {
    if (selector.startsWith("@")) {
      const reference = this.references.get(selector);
      if (!reference)
        throw new Error(`Browser reference ${selector} is unavailable. Capture a fresh BrowserSnapshot first.`);
      return reference;
    }
    return this.page().locator(selector);
  }

  private snapshotLocator(selector: string): Locator {
    if (selector.startsWith("@")) {
      throw new Error(
        "BrowserSnapshot accepts a CSS selector. Use the fresh reference with an interaction tool instead.",
      );
    }
    return this.page().locator(selector);
  }

  private trackPage(page: Page, label?: string): void {
    if (this.tabs.has(page)) return;
    this.tabs.set(page, { id: `tab-${this.nextTabId++}`, ...(label ? { label } : {}) });
    this.activePage ??= page;
    page.on("close", () => {
      this.tabs.delete(page);
      if (this.activePage === page) this.activePage = this.livePages()[0];
    });
  }

  private livePages(): Page[] {
    return [...this.tabs.keys()].filter((page) => !page.isClosed());
  }

  private tabId(page: Page): string {
    const tab = this.tabs.get(page);
    if (!tab) throw new Error("The browser tab is no longer tracked.");
    return tab.id;
  }

  private throwNavigationFailure(): void {
    const failure = this.navigationFailure;
    this.navigationFailure = undefined;
    if (failure) throw failure;
  }

  private async clearReferences(): Promise<void> {
    const references = [...this.references.values()];
    this.references.clear();
    await Promise.all(references.map((reference) => reference.dispose().catch(() => undefined)));
  }

  private async pageState(): Promise<{ readonly url: string; readonly title: string }> {
    const page = this.page();
    return { url: page.url(), title: await page.title() };
  }

  private async addReferenceAnnotations(page: Page): Promise<() => Promise<void>> {
    const annotations = await Promise.all(
      [...this.references.entries()].map(async ([reference, handle]) => {
        const box = await handle.boundingBox();
        return box ? { reference, ...box } : undefined;
      }),
    );
    const id = `senera-browser-annotations-${Math.random().toString(36).slice(2)}`;
    await page.evaluate(
      ({ id: overlayId, annotations: values }) => {
        const root = document.createElement("div");
        root.id = overlayId;
        root.style.cssText =
          "position:absolute;inset:0;z-index:2147483647;pointer-events:none;font:12px/1.2 monospace;";
        for (const annotation of values) {
          if (!annotation) continue;
          const label = document.createElement("span");
          label.textContent = annotation.reference;
          label.style.cssText = [
            "position:absolute",
            `left:${window.scrollX + annotation.x}px`,
            `top:${window.scrollY + annotation.y}px`,
            "padding:2px 4px",
            "color:#fff",
            "background:#111",
            "border:1px solid #fff",
            "border-radius:2px",
          ].join(";");
          root.append(label);
        }
        document.documentElement.append(root);
      },
      { id, annotations },
    );
    return async () => {
      await page.evaluate((overlayId) => document.getElementById(overlayId)?.remove(), id).catch(() => undefined);
    };
  }

  private async withAbort<TValue>(signal: AbortSignal | undefined, operation: () => Promise<TValue>): Promise<TValue> {
    assertNotAborted(signal);
    const onAbort = () => {
      void this.close();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await operation();
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

function isContainerRoot(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

function requiredComputerActions(input: Readonly<Record<string, unknown>>): AgentBrowserComputerAction[] {
  if (!Array.isArray(input.actions) || input.actions.length === 0) {
    throw new Error("Browser computer operation requires at least one action.");
  }
  return input.actions.map((value, index) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`Browser computer action ${index + 1} must be an object.`);
    }
    const type = (value as { readonly type?: unknown }).type;
    if (typeof type !== "string" || !AgentBrowserComputerActionTypes.includes(type as never)) {
      throw new Error(`Browser computer action ${index + 1} has an unsupported type.`);
    }
    return value as AgentBrowserComputerAction;
  });
}

function invalidatesBrowserSnapshotReferences(
  operation: AgentBrowserOperation,
  input: Readonly<Record<string, unknown>>,
): boolean {
  switch (operation) {
    case "read":
      return typeof input.url === "string";
    case "get_url":
    case "get_title":
    case "tab_list":
    case "screenshot":
      return false;
    default:
      return true;
  }
}

async function withBrowserModifiers<TValue>(
  page: Page,
  keys: readonly string[] | undefined,
  operation: () => Promise<TValue>,
): Promise<TValue> {
  const modifiers = (keys ?? []).map(normalizeBrowserKey);
  for (const modifier of modifiers) await page.keyboard.down(modifier);
  try {
    return await operation();
  } finally {
    for (const modifier of [...modifiers].reverse()) await page.keyboard.up(modifier);
  }
}

function normalizeBrowserKey(key: string): string {
  const normalized = key.trim().toUpperCase();
  const aliases: Readonly<Record<string, string>> = {
    ALT: "Alt",
    ARROWDOWN: "ArrowDown",
    ARROWLEFT: "ArrowLeft",
    ARROWRIGHT: "ArrowRight",
    ARROWUP: "ArrowUp",
    CMD: "Meta",
    COMMAND: "Meta",
    CONTROL: "Control",
    CTRL: "Control",
    ESC: "Escape",
    META: "Meta",
    RETURN: "Enter",
    SHIFT: "Shift",
    SPACE: " ",
    WINDOWS: "Meta",
    WIN: "Meta",
  };
  return aliases[normalized] ?? key;
}

async function readDownloadStream(
  stream: AsyncIterable<unknown> & { readonly destroy?: () => void },
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      assertNotAborted(signal);
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk instanceof Uint8Array ? chunk : undefined;
      if (!bytes) throw new Error("Browser download returned an unsupported stream chunk.");
      size += bytes.byteLength;
      if (size > maxBytes) throw new Error(`Browser download exceeds the configured ${maxBytes} byte limit.`);
      chunks.push(bytes);
    }
  } catch (error) {
    stream.destroy?.();
    throw error;
  }
  return Buffer.concat(chunks);
}
