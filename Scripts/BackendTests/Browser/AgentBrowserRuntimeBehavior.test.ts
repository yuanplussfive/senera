import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { AgentBrowserConfigurationSchema } from "../../../Source/AgentSystem/Browser/AgentBrowserConfiguration.js";
import type {
  AgentBrowserDriver,
  AgentBrowserDriverOperationOptions,
  AgentBrowserDriverOperationResult,
  AgentBrowserDriverSession,
  AgentBrowserDriverSessionOptions,
} from "../../../Source/AgentSystem/Browser/AgentBrowserDriver.js";
import {
  assertAgentBrowserWindowModeSupported,
  AgentBrowserExecutableResolutionError,
  resolveAgentBrowserExecutable,
} from "../../../Source/AgentSystem/Browser/AgentBrowserExecutableResolver.js";
import { AgentBrowserRuntime } from "../../../Source/AgentSystem/Browser/AgentBrowserRuntime.js";
import { createAgentBrowserSystemTools } from "../../../Source/AgentSystem/SystemTools/AgentBrowserSystemTools.js";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import type { SeneraExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import type { AgentHostToolContext } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import type { AgentBrowserOperation } from "../../../Source/AgentSystem/Browser/AgentBrowserTypes.js";

interface BrowserCall {
  readonly operation: AgentBrowserOperation;
  readonly input: Readonly<Record<string, unknown>>;
}

describe("controlled browser runtime", () => {
  test("keeps the controller in production dependencies without bundling a second browser", async () => {
    const manifest = JSON.parse(await fs.readFile(path.join(process.cwd(), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };

    expect(manifest.dependencies?.["playwright-core"]).toMatch(/^1\.62\./u);
    expect(manifest.dependencies?.playwright).toBeUndefined();
  });

  test("uses an explicit browser path before platform discovery", () => {
    const root = path.join(os.tmpdir(), "senera-browser-path");
    const expected = path.resolve(root, "tools", "chromium");

    expect(
      resolveAgentBrowserExecutable({
        configuredPath: path.join("tools", "chromium"),
        workspaceRoot: root,
        exists: (candidate) => candidate === expected,
      }),
    ).toBe(expected);
  });

  test("discovers a supported Windows browser when no path is configured", () => {
    const programFiles = path.join(os.tmpdir(), "Program Files");
    const expected = path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe");

    expect(
      resolveAgentBrowserExecutable({
        platform: "win32",
        environment: { ProgramFiles: programFiles, PATH: "" },
        exists: (candidate) => candidate === expected,
      }),
    ).toBe(expected);
  });

  test("discovers the Chromium installed by the Linux deployment image without relying on PATH", () => {
    expect(
      resolveAgentBrowserExecutable({
        platform: "linux",
        environment: { PATH: "" },
        exists: (candidate) => candidate === "/usr/bin/chromium",
      }),
    ).toBe("/usr/bin/chromium");
  });

  test("rejects visible-browser mode in a container before Chromium starts", () => {
    expect(() =>
      assertAgentBrowserWindowModeSupported({ headed: true, environment: { SENERA_CONTAINER: "1" } }),
    ).toThrow(/container deployment/u);
  });

  test("reports an actionable error when no browser can be resolved", () => {
    expect(() => resolveAgentBrowserExecutable({ exists: () => false, environment: { PATH: "" } })).toThrow(
      AgentBrowserExecutableResolutionError,
    );
  });

  test("allows public browser requests by default while retaining host-owned arguments", async () => {
    await withBrowserRuntime(async ({ runtime, driver, root }) => {
      const output = await runtime.execute(
        "open",
        {
          url: "https://example.com/docs#fragment",
          extraArgs: ["--remote-debugging-port=9222"],
          session: "model-controlled-session",
          executablePath: "C:\\unsafe.exe",
          profile: "model-controlled-profile",
        },
        browserContext(root),
      );

      expect(output.result).toMatchObject({ status: "completed", trust: "untrusted_browser_content" });
      expect(driver.calls).toEqual([{ operation: "open", input: { url: "https://example.com/docs" } }]);
      await expect(
        driver.sessions[0]!.options.assertRequestPermitted("https://example.com/app.js", "subresource"),
      ).resolves.toBeUndefined();
      await expect(
        driver.sessions[0]!.options.assertRequestPermitted("https://other.example/app.js", "subresource"),
      ).resolves.toBeUndefined();
    });
  });

  test("uses fixed allowlists only when explicitly selected", async () => {
    await withBrowserRuntime(
      async ({ runtime, driver, root }) => {
        await runtime.execute("open", { url: "https://example.com" }, browserContext(root));
        await expect(
          driver.sessions[0]!.options.assertRequestPermitted("https://other.example/app.js", "subresource"),
        ).rejects.toThrow(/outside the configured allowed domains/u);
      },
      { configuration: { network: { accessMode: "allowlist", allowedDomains: ["example.com"] } } },
    );
    expect(
      AgentBrowserConfigurationSchema.parse({ network: { accessMode: "allowlist" } }).network.allowedDomains,
    ).toEqual([]);
  });

  test("treats an empty allowlist as deny-all while configuration is being completed", async () => {
    await withBrowserRuntime(
      async ({ runtime, root }) => {
        await expect(runtime.execute("open", { url: "https://example.com" }, browserContext(root))).rejects.toThrow(
          /allowlist is empty/u,
        );
      },
      { configuration: { network: { accessMode: "allowlist" } } },
    );
  });

  test("migrates legacy configured domain restrictions to allowlist mode", () => {
    expect(
      AgentBrowserConfigurationSchema.parse({ network: { allowedDomains: ["example.com"] } }).network.accessMode,
    ).toBe("allowlist");
  });

  test("uses the model-selected timeout within the host-configured bound", async () => {
    await withBrowserRuntime(
      async ({ runtime, driver, root }) => {
        await runtime.execute("open", { url: "https://example.com", timeoutMs: 420_000 }, browserContext(root));
        await runtime.execute(
          "wait_for_load",
          { state: "load", waitTimeoutMs: 240_000, timeoutMs: 420_000 },
          browserContext(root),
        );
        expect(driver.operationTimeouts).toEqual([420_000, 420_000]);
        await expect(
          runtime.execute("open", { url: "https://example.com", timeoutMs: 600_001 }, browserContext(root)),
        ).rejects.toThrow(/between 1000 and 600000/u);
      },
      { configuration: { runtime: { maxOperationTimeoutMs: 600_000 } } },
    );
  });

  test("exposes a bounded timeoutMs input on every browser system tool", () => {
    const tools = createAgentBrowserSystemTools({ runtime: { maxOperationTimeoutMs: 600_000 } });
    const open = tools.find((tool) => tool.name === "BrowserOpen");
    const wait = tools.find((tool) => tool.name === "BrowserWaitForLoad");

    expect(open?.input.parse({ url: "https://example.com", timeoutMs: 420_000 })).toMatchObject({
      timeoutMs: 420_000,
    });
    expect(wait?.input.parse({ state: "load", timeoutMs: 420_000 })).toMatchObject({ timeoutMs: 420_000 });
    expect(open?.input.safeParse({ url: "https://example.com", timeoutMs: 600_001 }).success).toBe(false);
  });

  test("documents the snapshot-reference lifecycle for browser interactions", () => {
    const tools = createAgentBrowserSystemTools();
    const open = tools.find((tool) => tool.name === "BrowserOpen");
    const snapshot = tools.find((tool) => tool.name === "BrowserSnapshot");
    const click = tools.find((tool) => tool.name === "BrowserClick");

    expect(open?.metadata.description).toMatch(/invalidates earlier BrowserSnapshot references/u);
    expect(snapshot?.metadata.description).toMatch(/current page/u);
    expect(click?.metadata.description).toMatch(/most recent BrowserSnapshot/u);
  });

  test("rejects a URL resolved to a private network before the browser starts", async () => {
    await withBrowserRuntime(
      async ({ runtime, driver, root }) => {
        await expect(
          runtime.execute("open", { url: "https://internal.example" }, browserContext(root)),
        ).rejects.toThrow(/private or reserved network/u);
        expect(driver.calls).toHaveLength(0);
        expect(driver.sessions).toHaveLength(0);
      },
      { resolveHostAddresses: async () => ["127.0.0.1"] },
    );
  });

  test("permits a proxy Fake-IP mapping for a hostname without permitting direct reserved addresses", async () => {
    await withBrowserRuntime(
      async ({ runtime, driver, root }) => {
        await runtime.execute("open", { url: "https://proxied.example" }, browserContext(root));
        expect(driver.calls).toHaveLength(1);
        await expect(runtime.execute("open", { url: "https://198.18.0.62" }, browserContext(root))).rejects.toThrow(
          /private or reserved network/u,
        );
      },
      { resolveHostAddresses: async () => ["198.18.0.62"] },
    );

    await withBrowserRuntime(
      async ({ runtime, root }) => {
        await expect(runtime.execute("open", { url: "https://proxied.example" }, browserContext(root))).rejects.toThrow(
          /private or reserved network/u,
        );
      },
      {
        configuration: { network: { allowSyntheticProxyAddresses: false } },
        resolveHostAddresses: async () => ["198.18.0.62"],
      },
    );
  });

  test("stores Playwright screenshots as Artifact assets", async () => {
    await withBrowserRuntime(async ({ runtime, root }) => {
      const output = await runtime.execute("screenshot", { format: "png" }, browserContext(root));

      expect(output.result.screenshot).toMatchObject({
        mediaType: "image/png",
        markdown: expect.stringMatching(/^!\[Browser screenshot\]\(senera:\/\/artifact-asset\//u),
      });
      expect(output.artifactPayload.assets).toHaveLength(1);
      expect(Buffer.from(output.artifactPayload.assets![0]!.dataBase64, "base64")).toEqual(Buffer.from("senera-image"));
      expect(output.artifactPayload.rawResponse).toMatchObject({ source: "browser", backend: "playwright" });
    });
  });

  test("serializes operations within one Senera browser session", async () => {
    let releaseOpen!: () => void;
    const openStarted = deferred<void>();
    const openRelease = new Promise<void>((resolve) => {
      releaseOpen = resolve;
    });
    await withBrowserRuntime(
      async ({ runtime, driver, root }) => {
        const first = runtime.execute("open", { url: "https://example.com" }, browserContext(root));
        await openStarted.promise;
        const second = runtime.execute("snapshot", {}, browserContext(root));
        await Promise.resolve();
        expect(driver.calls.map((call) => call.operation)).toEqual(["open"]);

        releaseOpen();
        await Promise.all([first, second]);
        expect(driver.calls.map((call) => call.operation)).toEqual(["open", "snapshot"]);
      },
      {
        execute: async (operation) => {
          if (operation === "open") {
            openStarted.resolve();
            await openRelease;
          }
          return textResult(operation);
        },
      },
    );
  });

  test("closes every tracked browser session before the browser process", async () => {
    await withBrowserRuntime(async ({ runtime, driver, root }) => {
      await runtime.execute("open", { url: "https://example.com" }, browserContext(root));
      await runtime.close();

      expect(driver.sessions[0]!.closed).toBe(true);
      expect(driver.closeCalls).toBe(1);
    });
  });

  test("cancels active browser operations before waiting for shutdown", async () => {
    const started = deferred<void>();
    const cancelled = deferred<void>();
    await withBrowserRuntime(
      async ({ runtime, driver, root }) => {
        const operation = runtime.execute("open", { url: "https://example.com" }, browserContext(root));
        await started.promise;

        const closing = runtime.close();
        await cancelled.promise;
        await expect(operation).rejects.toMatchObject({ code: "ToolProcessCancelled" });
        await closing;

        expect(driver.sessions[0]!.closed).toBe(true);
      },
      {
        execute: async (operation, _input, options) => {
          if (operation !== "open") return textResult(operation);
          started.resolve();
          await waitForAbort(options.signal);
          cancelled.resolve();
          throw options.signal?.reason ?? new DOMException("Operation aborted.", "AbortError");
        },
      },
    );
  });

  test("does not wait for an unfinished browser startup during shutdown", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-browser-startup-"));
    const creationStarted = deferred<void>();
    const creation = deferred<AgentBrowserDriverSession>();
    const sessionClosed = deferred<void>();
    let closeCalls = 0;
    const driver: AgentBrowserDriver = {
      createSession: () => {
        creationStarted.resolve();
        return creation.promise;
      },
      close: async () => {
        closeCalls += 1;
      },
    };
    const runtime = new AgentBrowserRuntime({
      workspaceRoot: root,
      configuration: AgentBrowserConfigurationSchema.parse({}),
      driver,
      resolveHostAddresses: async () => ["93.184.216.34"],
    });
    try {
      const operation = runtime.execute("open", { url: "https://example.com" }, browserContext(root));
      await creationStarted.promise;

      await runtime.close();
      await expect(operation).rejects.toMatchObject({ code: "ToolProcessCancelled" });
      expect(closeCalls).toBe(1);

      creation.resolve({
        execute: async () => textResult("unexpected"),
        close: async () => {
          sessionClosed.resolve();
        },
      });
      await sessionClosed.promise;
    } finally {
      await runtime.close().catch(() => undefined);
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

async function withBrowserRuntime(
  operation: (context: { runtime: AgentBrowserRuntime; driver: FakeBrowserDriver; root: string }) => Promise<void>,
  options: {
    readonly resolveHostAddresses?: (hostname: string) => Promise<readonly string[]>;
    readonly configuration?: Record<string, unknown>;
    readonly execute?: (
      operation: AgentBrowserOperation,
      input: Readonly<Record<string, unknown>>,
      options: AgentBrowserDriverOperationOptions,
    ) => Promise<AgentBrowserDriverOperationResult>;
  } = {},
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-browser-runtime-"));
  const driver = new FakeBrowserDriver(options.execute);
  const runtime = new AgentBrowserRuntime({
    workspaceRoot: root,
    configuration: AgentBrowserConfigurationSchema.parse(options.configuration ?? {}),
    driver,
    resolveHostAddresses: options.resolveHostAddresses ?? (async () => ["93.184.216.34"]),
  });
  try {
    await operation({ runtime, driver, root });
  } finally {
    await runtime.close().catch(() => undefined);
    await fs.rm(root, { recursive: true, force: true });
  }
}

class FakeBrowserDriver implements AgentBrowserDriver {
  readonly calls: BrowserCall[] = [];
  readonly operationTimeouts: number[] = [];
  readonly sessions: FakeBrowserSession[] = [];
  closeCalls = 0;

  constructor(
    private readonly handler: (
      operation: AgentBrowserOperation,
      input: Readonly<Record<string, unknown>>,
      options: AgentBrowserDriverOperationOptions,
    ) => Promise<AgentBrowserDriverOperationResult> = (operation) => Promise.resolve(textResult(operation)),
  ) {}

  async createSession(options: AgentBrowserDriverSessionOptions): Promise<AgentBrowserDriverSession> {
    const session = new FakeBrowserSession(this, options, this.handler);
    this.sessions.push(session);
    return session;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

class FakeBrowserSession implements AgentBrowserDriverSession {
  closed = false;

  constructor(
    private readonly driver: FakeBrowserDriver,
    readonly options: AgentBrowserDriverSessionOptions,
    private readonly handler: (
      operation: AgentBrowserOperation,
      input: Readonly<Record<string, unknown>>,
      options: AgentBrowserDriverOperationOptions,
    ) => Promise<AgentBrowserDriverOperationResult>,
  ) {}

  async execute(
    operation: AgentBrowserOperation,
    input: Readonly<Record<string, unknown>>,
    options: AgentBrowserDriverOperationOptions,
  ): Promise<AgentBrowserDriverOperationResult> {
    this.driver.calls.push({ operation, input });
    this.driver.operationTimeouts.push(options.timeoutMs);
    if (operation === "open" && typeof input.url === "string") {
      await this.options.assertRequestPermitted(input.url, "navigation");
    }
    if (operation === "screenshot") return screenshotResult();
    return this.handler(operation, input, options);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function textResult(value: string): AgentBrowserDriverOperationResult {
  return { content: value };
}

function screenshotResult(): AgentBrowserDriverOperationResult {
  return {
    content: "Captured browser screenshot.",
    screenshot: { data: Buffer.from("senera-image"), mediaType: "image/png" },
  };
}

function deferred<TValue>() {
  let resolve!: (value: TValue | PromiseLike<TValue>) => void;
  const promise = new Promise<TValue>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  if (!signal) return Promise.reject(new Error("Expected an operation abort signal."));
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

function browserContext(workspaceRoot: string): AgentHostToolContext {
  return {
    tool: {} as RegisteredTool,
    config: { ModelProviders: [] },
    workspaceRoot,
    registry: new AgentExtensionRegistry(),
    executionEnv: {} as SeneraExecutionEnv,
    sessionId: "senera-session-under-test",
    requestId: "request-under-test",
    toolCallId: "tool-call-under-test",
  };
}
