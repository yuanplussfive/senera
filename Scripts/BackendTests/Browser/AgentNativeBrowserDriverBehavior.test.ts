import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { AgentBrowserConfigurationSchema } from "../../../Source/AgentSystem/Browser/AgentBrowserConfiguration.js";
import type {
  AgentBrowserCdpDownloadRequest,
  AgentBrowserCdpDownloader,
} from "../../../Source/AgentSystem/Browser/AgentBrowserCdpDownload.js";
import { serializeError } from "../../../Source/AgentSystem/Diagnostics/AgentErrorSerializer.js";
import type {
  AgentBrowserDriverOperationOptions,
  AgentBrowserDriverSessionOptions,
} from "../../../Source/AgentSystem/Browser/AgentBrowserDriver.js";
import {
  AgentNativeBrowserCommandError,
  AgentNativeBrowserDriver,
  agentBrowserCliEnvironment,
  agentBrowserCommandEnvironment,
} from "../../../Source/AgentSystem/Browser/AgentNativeBrowserDriver.js";

describe("AgentNativeBrowserDriver downloads", () => {
  test("preflights a resolved direct download target before activating the control", async () => {
    const fixture = await createDownloadFixture({ href: "/exports/report.csv", download: "quarter.csv" });
    try {
      const session = await fixture.driver.createSession(fixture.sessionOptions);
      const result = await session.execute("download", { selector: "@e4" }, { timeoutMs: 5_000 });

      expect(fixture.assertRequestPermitted).toHaveBeenCalledWith(
        "https://example.com/exports/report.csv",
        "subresource",
        "https://example.com/reports",
      );
      expect(fixture.downloadRequests).toHaveLength(1);
      expect(fixture.commands.some((command) => endsWith(command, ["click", "@e4"]))).toBe(true);
      expect(fixture.commands.some((command) => isLegacyDownloadCommand(command))).toBe(false);
      expect(result.download).toMatchObject({
        data: Buffer.from("id,total\n1,42\n"),
        fileName: "quarter.csv",
        url: "https://example.com/exports/report.csv",
      });
    } finally {
      await fixture.dispose();
    }
  });

  test.each(["javascript:;", undefined])(
    "activates controls without a navigable href (%s) without preflighting an invalid URL",
    async (href) => {
      const fixture = await createDownloadFixture({ href, reportedUrl: "/reports/export" });
      try {
        const session = await fixture.driver.createSession(fixture.sessionOptions);
        const result = await session.execute("download", { selector: "@e4" }, { timeoutMs: 5_000 });

        expect(fixture.assertRequestPermitted).not.toHaveBeenCalled();
        expect(fixture.downloadRequests).toHaveLength(1);
        expect(result.download).toMatchObject({
          data: Buffer.from("id,total\n1,42\n"),
          fileName: "report",
          url: "https://example.com/reports/export",
        });
      } finally {
        await fixture.dispose();
      }
    },
  );

  test("downloads persistent sessions through the managed browser CDP endpoint", async () => {
    const fixture = await createDownloadFixture({ context: "persistent", href: "/exports/report.csv" });
    try {
      const session = await fixture.driver.createSession(fixture.sessionOptions);
      const result = await session.execute("download", { selector: "@e4" }, { timeoutMs: 5_000 });

      expect(fixture.downloadRequests).toHaveLength(1);
      expect(fixture.downloadRequests[0]?.cdpUrl).toBe("ws://127.0.0.1:9222/devtools/browser/test");
      expect(fixture.commands.some((command) => isLegacyDownloadCommand(command))).toBe(false);
      expect(result.download).toMatchObject({ fileName: "report", url: "https://example.com/exports/report.csv" });
    } finally {
      await fixture.dispose();
    }
  });

  test("rejects a download the browser reports outside the controlled directory", async () => {
    const fixture = await createDownloadFixture({
      href: "/exports/report.csv",
      filePath: (root) => path.join(root, "outside.csv"),
    });
    try {
      const session = await fixture.driver.createSession(fixture.sessionOptions);
      await expect(session.execute("download", { selector: "@e4" }, { timeoutMs: 5_000 })).rejects.toThrow(
        /outside the controlled download directory/u,
      );
    } finally {
      await fixture.dispose();
    }
  });

  test("saves an explicit image URL without treating it as a selector or clicking the page", async () => {
    const fixture = await createDownloadFixture({});
    try {
      const session = await fixture.driver.createSession(fixture.sessionOptions);
      await session.execute("download", { url: "/photos/original.png" }, { timeoutMs: 5_000 });
      expect(fixture.downloadRequests[0]?.source).toEqual({ url: "https://example.com/photos/original.png" });
      expect(fixture.commands.some((command) => command.includes("click"))).toBe(false);
      expect(fixture.assertRequestPermitted).toHaveBeenCalledWith(
        "https://example.com/photos/original.png",
        "subresource",
        "https://example.com/reports",
      );
    } finally {
      await fixture.dispose();
    }
  });
});

describe("AgentNativeBrowserDriver close", () => {
  test("treats a daemon that exits while serving close as the end of the session", async () => {
    const fixture = await createCommandFixture(async ({ command }) => {
      if (endsWith(command, ["close"])) {
        throw new AgentNativeBrowserCommandError(
          "Invalid response: EOF while parsing a value at line 1 column 0 (the command reached the daemon but no response came back; it may or may not have run, so it was not retried)",
        );
      }
      return undefined;
    });
    try {
      const session = await fixture.driver.createSession(fixture.sessionOptions);
      await expect(session.close()).resolves.toBeUndefined();
    } finally {
      await fixture.dispose();
    }
  });

  test("still surfaces a close the daemon refused", async () => {
    const fixture = await createCommandFixture(async ({ command }) => {
      if (endsWith(command, ["close"])) {
        throw new AgentNativeBrowserCommandError("The controlled browser refused to close.");
      }
      return undefined;
    });
    try {
      const session = await fixture.driver.createSession(fixture.sessionOptions);
      await expect(session.close()).rejects.toThrow(/refused to close/u);
    } finally {
      await fixture.dispose();
    }
  });
});

describe("AgentNativeBrowserDriver environment", () => {
  test("does not forward the Windows compatibility layer to the browser process", () => {
    const environment = agentBrowserCommandEnvironment({
      PATH: "C:\\Windows\\System32",
      __COMPAT_LAYER: "HighDpiAware",
    });

    expect(environment).toEqual({ PATH: "C:\\Windows\\System32" });
    expect(agentBrowserCommandEnvironment({ __compat_layer: "HighDpiAware" })).toEqual({});
  });

  test("replaces an inherited CLI timeout with the configured default", () => {
    const environment = agentBrowserCommandEnvironment(
      { PATH: "C:\\tools", AGENT_BROWSER_DEFAULT_TIMEOUT: "900000" },
      25_000,
    );

    expect(environment).toEqual({ PATH: "C:\\tools", AGENT_BROWSER_DEFAULT_TIMEOUT: "25000" });
    expect(agentBrowserCommandEnvironment(undefined, 25_000).AGENT_BROWSER_DEFAULT_TIMEOUT).toBe("25000");
  });

  test("keeps the CLI timeout identical across commands so the daemon never relaunches the browser", () => {
    const environment = agentBrowserCliEnvironment(
      { PATH: "C:\\tools", AGENT_BROWSER_DEFAULT_TIMEOUT: "900000" },
      180_000,
    );

    expect(environment).toEqual({ PATH: "C:\\tools", AGENT_BROWSER_DEFAULT_TIMEOUT: "180000" });
    expect(agentBrowserCliEnvironment({ PATH: "C:\\tools" }, 180_000)).toEqual(environment);
  });
});

describe("AgentNativeBrowserDriver command budgets", () => {
  test("waits fixed delays locally instead of spending a browser command", async () => {
    const fixture = await createCommandFixture(async () => ({}));
    const session = await fixture.driver.createSession(fixture.sessionOptions);
    try {
      await session.execute("wait_ms", { ms: 5 }, { timeoutMs: 1_000 });

      expect(fixture.commands.some((command) => command.includes("wait"))).toBe(false);
    } finally {
      await fixture.dispose();
    }
  });

  test("rejects a fixed delay that exceeds the operation budget", async () => {
    const fixture = await createCommandFixture(async () => ({}));
    const session = await fixture.driver.createSession(fixture.sessionOptions);
    try {
      await expect(session.execute("wait_ms", { ms: 5_000 }, { timeoutMs: 1_000 })).rejects.toThrow(
        /timed out|exceeds the \d+ms operation budget/u,
      );
    } finally {
      await fixture.dispose();
    }
  });

  test("passes the remaining budget to native waits without changing the session default", async () => {
    let attempts = 0;
    const timeouts: number[] = [];
    const fixture = await createCommandFixture(async ({ command, options }) => {
      if (command.includes("--text")) {
        attempts += 1;
        timeouts.push(options.timeoutMs);
        if (attempts === 1) throw new AgentNativeBrowserCommandError("Wait timed out.", "timeout");
        return { waited: true };
      }
      return {};
    });
    const session = await fixture.driver.createSession(fixture.sessionOptions);
    try {
      await session.execute("wait_for_text", { text: "Ready" }, { timeoutMs: 40_000 });

      expect(attempts).toBe(2);
      expect(timeouts[0]).toBeGreaterThan(39_000);
      expect(timeouts[0]).toBeLessThanOrEqual(40_000);
      expect(timeouts[1]).toBeLessThan(timeouts[0]!);
      expect(
        fixture.commands
          .filter((command) => command.includes("--text"))
          .every((command) => command.includes("--timeout")),
      ).toBe(true);
    } finally {
      await fixture.dispose();
    }
  });

  test("maps URL and predicate waits to their CLI conditions", async () => {
    const fixture = await createCommandFixture(async () => ({}));
    const session = await fixture.driver.createSession(fixture.sessionOptions);
    try {
      await session.execute("wait_for_url", { urlPattern: "**/dashboard" }, { timeoutMs: 5_000 });
      await session.execute("wait_for_function", { expression: "window.ready === true" }, { timeoutMs: 5_000 });

      expect(
        fixture.commands.some(
          (command) => command.includes("--url") && command.includes("**/dashboard") && command.includes("--timeout"),
        ),
      ).toBe(true);
      expect(
        fixture.commands.some(
          (command) =>
            command.includes("--fn") && command.includes("window.ready === true") && command.includes("--timeout"),
        ),
      ).toBe(true);
    } finally {
      await fixture.dispose();
    }
  });

  test("recovers a navigation the CLI could not acknowledge", async () => {
    let committed = false;
    let openAttempts = 0;
    const fixture = await createCommandFixture(async ({ command }) => {
      if (endsWith(command, ["open", "https://slow.example/page"])) {
        openAttempts += 1;
        committed = true;
        throw new AgentNativeBrowserCommandError("agent-browser command timed out.", "outcome_unknown");
      }
      if (endsWith(command, ["get", "url"])) return { url: committed ? "https://slow.example/page" : "about:blank" };
      if (endsWith(command, ["get", "title"])) return { title: "Slow Page" };
      return {};
    });
    const session = await fixture.driver.createSession(fixture.sessionOptions);
    try {
      const result = await session.execute("open", { url: "https://slow.example/page" }, { timeoutMs: 5_000 });

      expect(openAttempts).toBe(1);
      expect(result.page).toEqual({ url: "https://slow.example/page", title: "Slow Page" });
      expect(result.navigation).toEqual({ status: "pending" });
      expect(
        fixture.commands.filter((command) => endsWith(command, ["open", "https://slow.example/page"])),
      ).toHaveLength(1);
    } finally {
      await fixture.dispose();
    }
  });

  test("hands an unfinished navigation back with an actionable timeout", async () => {
    const fixture = await createCommandFixture(async ({ command }) => {
      if (endsWith(command, ["open", "https://never.example/"]))
        throw new AgentNativeBrowserCommandError("agent-browser command timed out.", "outcome_unknown");
      if (endsWith(command, ["get", "url"])) return { url: "about:blank" };
      return {};
    });
    const session = await fixture.driver.createSession(fixture.sessionOptions);
    try {
      await expect(session.execute("open", { url: "https://never.example/" }, { timeoutMs: 1_000 })).rejects.toThrow(
        /did not confirm the navigation before the operation timeout|timed out/u,
      );
    } finally {
      await fixture.dispose();
    }
  });

  test("clears a stale strict tab binding and retries the navigation", async () => {
    let openAttempts = 0;
    const fixture = await createCommandFixture(async ({ command }) => {
      if (endsWith(command, ["open", "https://example.com/"])) {
        openAttempts += 1;
        if (openAttempts === 1)
          throw new AgentNativeBrowserCommandError("tab_gone: bound tab is gone (target dead).", "tab_gone");
        return { targetId: "fresh-target", url: "https://example.com/", title: "Example Domain" };
      }
      if (endsWith(command, ["tab", "new", "about:blank"])) return { targetId: "fresh-target", url: "about:blank" };
      return undefined;
    });
    const session = await fixture.driver.createSession(fixture.sessionOptions);
    try {
      const result = await session.execute("open", { url: "https://example.com/" }, { timeoutMs: 5_000 });

      expect(openAttempts).toBe(2);
      const rebind = fixture.commands.find((command) => endsWith(command, ["tab", "new", "about:blank"]));
      expect(rebind).toContain("--no-pin-tab");
      expect(result.page).toEqual({ url: "https://example.com/", title: "Example Domain" });
    } finally {
      await fixture.dispose();
    }
  });

  test("resets a lost tab for non-navigation work and asks for a reopen", async () => {
    const fixture = await createCommandFixture(async ({ command }) => {
      if (command.includes("snapshot"))
        throw new AgentNativeBrowserCommandError("tab_gone: bound tab is gone (target dead).", "tab_gone");
      if (endsWith(command, ["tab", "new", "about:blank"])) return { targetId: "fresh-target", url: "about:blank" };
      return {};
    });
    const session = await fixture.driver.createSession(fixture.sessionOptions);
    try {
      await expect(session.execute("snapshot", {}, { timeoutMs: 5_000 })).rejects.toThrow(/open the page again/u);

      const rebind = fixture.commands.find((command) => endsWith(command, ["tab", "new", "about:blank"]));
      expect(rebind).toContain("--no-pin-tab");
      expect(fixture.commands.filter((command) => command.includes("snapshot"))).toHaveLength(1);
    } finally {
      await fixture.dispose();
    }
  });
});

describe("AgentNativeBrowserDriver browser contexts", () => {
  test("does not serialize private browser control-plane endpoints", () => {
    const error = new AgentNativeBrowserCommandError(
      "Could not connect to ws://127.0.0.1:9222/devtools/browser/private-token.",
      "connection_failed",
    );

    const serialized = serializeError(error);
    expect(JSON.stringify(serialized)).toContain("[internal browser endpoint]");
    expect(JSON.stringify(serialized)).not.toContain("private-token");
    expect(serialized).not.toHaveProperty("command");
  });

  test("connects persistent sessions through a Senera-owned profile browser", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-native-browser-profile-"));
    const profileRoot = path.join(root, "profiles");
    const commands: string[][] = [];
    const driver = new AgentNativeBrowserDriver({
      workspaceRoot: root,
      browserProfilesRoot: profileRoot,
      configuration: AgentBrowserConfigurationSchema.parse({ runtime: { context: "persistent" } }),
      resolveController: () => "test-controller",
      probeCdpEndpoint: async () => true,
      executeCommand: async ({ command }) => {
        const recorded = [...command];
        commands.push(recorded);
        if (endsWith(recorded, ["get", "cdp-url"])) return { cdpUrl: "ws://127.0.0.1:9222/devtools/browser/test" };
        if (endsWith(recorded, ["open", "about:blank"]) && recorded.includes("--cdp")) {
          return { targetId: `target-${commandOption(recorded, "--session")}` };
        }
        if (endsWith(recorded, ["get", "url"])) return { url: "https://example.com/" };
        if (endsWith(recorded, ["get", "title"])) return { title: "Example Domain" };
        return {};
      },
    });
    const firstSession = await driver.createSession({
      sessionId: "persistent-browser-test",
      context: "persistent",
      requestTimeoutMs: 5_000,
      maxDownloadBytes: 128 * 1024,
      assertRequestPermitted: async () => undefined,
    });
    const secondSession = await driver.createSession({
      sessionId: "persistent-browser-test-second",
      context: "persistent",
      requestTimeoutMs: 5_000,
      maxDownloadBytes: 128 * 1024,
      assertRequestPermitted: async () => undefined,
    });

    try {
      await Promise.all([
        firstSession.execute("get_url", {}, { timeoutMs: 5_000 }),
        secondSession.execute("get_title", {}, { timeoutMs: 5_000 }),
      ]);

      const profileDirectory = path.join(profileRoot, "managed");
      const ownerStarts = commands.filter(
        (command) => endsWith(command, ["open", "about:blank"]) && command.includes("--profile"),
      );
      const sessionStarts = commands.filter(
        (command) => endsWith(command, ["open", "about:blank"]) && command.includes("--cdp"),
      );
      const sessionRead = commands.find((command) => endsWith(command, ["get", "url"]) && command.includes("--cdp"));
      const sessionTitle = commands.find((command) => endsWith(command, ["get", "title"]) && command.includes("--cdp"));
      expect(ownerStarts).toHaveLength(1);
      expect(sessionStarts).toHaveLength(2);
      expect(ownerStarts[0]).toEqual(expect.arrayContaining(["--profile", profileDirectory]));
      expect(sessionRead).toEqual(
        expect.arrayContaining(["--cdp", "ws://127.0.0.1:9222/devtools/browser/test", "--pin-tab"]),
      );
      expect(sessionRead).not.toContain("--profile");
      expect(sessionTitle).toEqual(
        expect.arrayContaining(["--cdp", "ws://127.0.0.1:9222/devtools/browser/test", "--pin-tab"]),
      );
      expect(sessionTitle).not.toContain("--profile");
    } finally {
      await driver.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("relaunches a persistent browser whose CDP endpoint exited", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-native-browser-relaunch-"));
    const profileRoot = path.join(root, "profiles");
    const endpoints = ["ws://127.0.0.1:9333/devtools/browser/first", "ws://127.0.0.1:9334/devtools/browser/second"];
    const alive = new Set([endpoints[0]!]);
    const commands: string[][] = [];
    let endpointsIssued = 0;
    const driver = new AgentNativeBrowserDriver({
      workspaceRoot: root,
      browserProfilesRoot: profileRoot,
      configuration: AgentBrowserConfigurationSchema.parse({ runtime: { context: "persistent" } }),
      resolveController: () => "test-controller",
      probeCdpEndpoint: async (cdpUrl) => alive.has(cdpUrl),
      executeCommand: async ({ command }) => {
        const recorded = [...command];
        commands.push(recorded);
        if (endsWith(recorded, ["open", "about:blank"]) && recorded.includes("--profile")) return {};
        if (endsWith(recorded, ["open", "about:blank"]) && recorded.includes("--cdp")) {
          return { targetId: `session-tab-${endpointsIssued}` };
        }
        if (endsWith(recorded, ["tab", "new", "about:blank"])) return { targetId: "rebound-tab" };
        if (endsWith(recorded, ["get", "cdp-url"])) {
          const cdpUrl = endpoints[endpointsIssued++]!;
          alive.add(cdpUrl);
          return { cdpUrl };
        }
        if (endsWith(recorded, ["get", "url"])) return { url: "https://example.com/" };
        return {};
      },
    });
    const session = await driver.createSession({
      sessionId: "persistent-relaunch-test",
      context: "persistent",
      requestTimeoutMs: 5_000,
      maxDownloadBytes: 128 * 1024,
      assertRequestPermitted: async () => undefined,
    });

    try {
      await session.execute("get_url", {}, { timeoutMs: 5_000 });
      const sessionLaunches = () =>
        commands.filter((command) => endsWith(command, ["open", "about:blank"]) && command.includes("--cdp"));
      const rebinds = () => commands.filter((command) => endsWith(command, ["tab", "new", "about:blank"]));
      expect(sessionLaunches()).toHaveLength(1);
      expect(rebinds()).toHaveLength(0);

      alive.clear();
      await session.execute("get_url", {}, { timeoutMs: 5_000 });

      const ownerLaunches = commands.filter(
        (command) => endsWith(command, ["open", "about:blank"]) && command.includes("--profile"),
      );
      expect(ownerLaunches).toHaveLength(2);
      expect(sessionLaunches()).toHaveLength(1);
      expect(rebinds()).toHaveLength(1);
      expect(rebinds()[0]).toEqual(expect.arrayContaining(["--cdp", endpoints[1]]));
      const rebindIndex = commands.lastIndexOf(rebinds()[0]!);
      const readIndex = commands.map((command) => endsWith(command, ["get", "url"])).lastIndexOf(true);
      expect(rebindIndex).toBeLessThan(readIndex);

      alive.add(endpoints[1]!);
      await session.execute("get_url", {}, { timeoutMs: 5_000 });
      expect(rebinds()).toHaveLength(1);
    } finally {
      await session.close();
      await driver.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("scopes persistent tabs to the host session", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-native-browser-tab-scope-"));
    const profileRoot = path.join(root, "profiles");
    const commands: string[][] = [];
    const tabs: Array<Record<string, unknown>> = [];
    const driver = new AgentNativeBrowserDriver({
      workspaceRoot: root,
      browserProfilesRoot: profileRoot,
      configuration: AgentBrowserConfigurationSchema.parse({ runtime: { context: "persistent" } }),
      resolveController: () => "test-controller",
      probeCdpEndpoint: async () => true,
      executeCommand: async ({ command }) => {
        const recorded = [...command];
        commands.push(recorded);
        const sessionId = commandOption(recorded, "--session") ?? "unknown";
        if (endsWith(recorded, ["get", "cdp-url"])) return { cdpUrl: "ws://127.0.0.1:9223/devtools/browser/test" };
        if (endsWith(recorded, ["open", "about:blank"]) && recorded.includes("--cdp")) {
          const targetId = `${sessionId}-target`;
          tabs.push({ targetId, tabId: `t${tabs.length + 1}`, title: sessionId, url: "about:blank", active: true });
          return { targetId, url: "about:blank", title: sessionId };
        }
        if (endsWith(recorded, ["tab", "list"])) return { tabs };
        if (endsWith(recorded, ["get", "url"])) return { url: "about:blank" };
        if (endsWith(recorded, ["get", "title"])) return { title: sessionId };
        return {};
      },
    });
    const alpha = await driver.createSession({
      sessionId: "alpha",
      context: "persistent",
      requestTimeoutMs: 5_000,
      maxDownloadBytes: 128 * 1024,
      assertRequestPermitted: async () => undefined,
    });
    const beta = await driver.createSession({
      sessionId: "beta",
      context: "persistent",
      requestTimeoutMs: 5_000,
      maxDownloadBytes: 128 * 1024,
      assertRequestPermitted: async () => undefined,
    });

    try {
      await alpha.execute("get_url", {}, { timeoutMs: 5_000 });
      await beta.execute("get_url", {}, { timeoutMs: 5_000 });

      const listed = await alpha.execute("tab_list", {}, { timeoutMs: 5_000 });
      expect(listed.content).toContain("alpha");
      expect(listed.content).not.toContain("beta");

      await expect(alpha.execute("tab_switch", { tab: "beta-target" }, { timeoutMs: 5_000 })).rejects.toThrow(
        /not owned/u,
      );
      await expect(alpha.execute("tab_close", { tab: "beta-target" }, { timeoutMs: 5_000 })).rejects.toThrow(
        /not owned/u,
      );
      expect(commands.some((command) => endsWith(command, ["tab", "beta-target"]))).toBe(false);
      expect(commands.some((command) => endsWith(command, ["tab", "close", "beta-target"]))).toBe(false);

      await alpha.execute("tab_close", {}, { timeoutMs: 5_000 });
      expect(
        commands.some(
          (command) =>
            command.includes("--session") &&
            commandOption(command, "--session") === "alpha" &&
            endsWith(command, ["tab", "close"]),
        ),
      ).toBe(true);

      await beta.close();
      expect(
        commands.some(
          (command) =>
            commandOption(command, "--session") === "beta" && endsWith(command, ["tab", "close", "beta-target"]),
        ),
      ).toBe(true);
    } finally {
      await driver.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("waits for a shared profile to finish closing before reopening it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-native-browser-profile-close-"));
    const profileRoot = path.join(root, "profiles");
    const closeStarted = deferred<void>();
    const allowClose = deferred<void>();
    let ownerLaunches = 0;
    const executeCommand = async ({ command }: { readonly command: readonly string[] }) => {
      if (endsWith(command, ["open", "about:blank"]) && command.includes("--profile")) {
        ownerLaunches += 1;
        return {};
      }
      if (endsWith(command, ["get", "cdp-url"])) return { cdpUrl: "ws://127.0.0.1:9224/devtools/browser/test" };
      if (endsWith(command, ["open", "about:blank"]) && command.includes("--cdp")) {
        return { targetId: `target-${commandOption(command, "--session")}` };
      }
      if (endsWith(command, ["get", "url"])) return { url: "https://example.com/" };
      if (endsWith(command, ["get", "title"])) return { title: "Example Domain" };
      if (endsWith(command, ["close"]) && command.includes("--profile")) {
        closeStarted.resolve();
        await allowClose.promise;
      }
      return {};
    };
    const createDriver = () =>
      new AgentNativeBrowserDriver({
        workspaceRoot: root,
        browserProfilesRoot: profileRoot,
        configuration: AgentBrowserConfigurationSchema.parse({ runtime: { context: "persistent" } }),
        resolveController: () => "test-controller",
        probeCdpEndpoint: async () => true,
        executeCommand,
      });
    const firstDriver = createDriver();
    const firstSession = await firstDriver.createSession({
      sessionId: "profile-close-first",
      context: "persistent",
      requestTimeoutMs: 5_000,
      maxDownloadBytes: 128 * 1024,
      assertRequestPermitted: async () => undefined,
    });
    let secondDriver: AgentNativeBrowserDriver | undefined;

    try {
      await firstSession.execute("get_url", {}, { timeoutMs: 5_000 });
      const closing = firstDriver.close();
      await closeStarted.promise;

      secondDriver = createDriver();
      const secondSession = await secondDriver.createSession({
        sessionId: "profile-close-second",
        context: "persistent",
        requestTimeoutMs: 5_000,
        maxDownloadBytes: 128 * 1024,
        assertRequestPermitted: async () => undefined,
      });
      const reopening = secondSession.execute("get_url", {}, { timeoutMs: 5_000 });
      await Promise.resolve();
      expect(ownerLaunches).toBe(1);

      allowClose.resolve();
      await closing;
      await reopening;
      expect(ownerLaunches).toBe(2);
    } finally {
      allowClose.resolve();
      await firstDriver.close().catch(() => undefined);
      await secondDriver?.close().catch(() => undefined);
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("keeps temporary sessions free of managed profile and CDP arguments", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-native-browser-temporary-"));
    const commands: string[][] = [];
    const driver = new AgentNativeBrowserDriver({
      workspaceRoot: root,
      browserProfilesRoot: path.join(root, "profiles"),
      configuration: AgentBrowserConfigurationSchema.parse({ runtime: { context: "temporary" } }),
      resolveController: () => "test-controller",
      probeCdpEndpoint: async () => true,
      executeCommand: async ({ command }) => {
        const recorded = [...command];
        commands.push(recorded);
        if (endsWith(recorded, ["get", "url"])) return { url: "https://example.com/" };
        if (endsWith(recorded, ["get", "title"])) return { title: "Example Domain" };
        return {};
      },
    });
    const session = await driver.createSession({
      sessionId: "temporary-browser-test",
      context: "temporary",
      requestTimeoutMs: 5_000,
      maxDownloadBytes: 128 * 1024,
      assertRequestPermitted: async () => undefined,
    });

    try {
      await session.execute("get_url", {}, { timeoutMs: 5_000 });
      expect(commands).not.toContainEqual(expect.arrayContaining(["--profile"]));
      expect(commands).not.toContainEqual(expect.arrayContaining(["--cdp"]));
    } finally {
      await driver.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

async function createDownloadFixture(input: {
  readonly href?: string;
  readonly download?: string;
  readonly context?: "persistent" | "temporary";
  readonly reportedUrl?: string;
  readonly filePath?: (root: string) => string;
}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-native-browser-"));
  const commands: string[][] = [];
  const downloadRequests: AgentBrowserCdpDownloadRequest[] = [];
  const assertRequestPermitted = vi.fn(async () => undefined);
  const downloader: AgentBrowserCdpDownloader = async (request) => {
    downloadRequests.push(request);
    if ("activate" in request.source) await request.source.activate(new AbortController().signal);
    const filePath = input.filePath?.(root) ?? path.join(request.directory, "report.csv");
    await fs.writeFile(filePath, "id,total\n1,42\n");
    return {
      filePath,
      suggestedFilename: input.download ?? "report",
      ...(input.reportedUrl ? { url: input.reportedUrl } : {}),
    };
  };
  const pageUrl = "https://example.com/reports";
  const driver = new AgentNativeBrowserDriver({
    workspaceRoot: root,
    browserProfilesRoot: path.join(root, "profiles"),
    configuration: AgentBrowserConfigurationSchema.parse({ runtime: { context: input.context ?? "temporary" } }),
    resolveController: () => "test-controller",
    probeCdpEndpoint: async () => true,
    resolveExecutable: () => undefined,
    downloader,
    executeCommand: async ({ command }) => {
      const recorded = [...command];
      commands.push(recorded);
      if (endsWith(recorded, ["get", "cdp-url"])) return { cdpUrl: "ws://127.0.0.1:9222/devtools/browser/test" };
      if (endsWith(recorded, ["open", "about:blank"]) && recorded.includes("--cdp")) {
        return { targetId: `target-${commandOption(recorded, "--session")}` };
      }
      if (endsWith(recorded, ["get", "url"])) {
        return { url: pageUrl };
      }
      if (endsWith(recorded, ["tab", "list"])) return { tabs: [{ targetId: "test-tab", active: true }] };
      if (endsWith(recorded, ["get", "title"])) return { title: "Reports" };
      if (endsWith(recorded, ["get", "attr", "@e4", "href"])) return { value: input.href };
      if (endsWith(recorded, ["get", "attr", "@e4", "download"])) return { value: input.download };
      if (endsWith(recorded, ["click", "@e4"])) {
        return { clicked: "Clicked @e4." };
      }
      return {};
    },
  });
  const sessionOptions: AgentBrowserDriverSessionOptions = {
    sessionId: "browser-download-test",
    requestTimeoutMs: 5_000,
    maxDownloadBytes: 128 * 1024,
    assertRequestPermitted,
    ...(input.context ? { context: input.context } : {}),
  };

  return {
    driver,
    commands,
    downloadRequests,
    assertRequestPermitted,
    sessionOptions,
    dispose: async () => {
      await driver.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

async function createCommandFixture(
  handler: (request: {
    readonly command: readonly string[];
    readonly options: AgentBrowserDriverOperationOptions;
  }) => Promise<unknown>,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-native-browser-command-"));
  const commands: string[][] = [];
  const driver = new AgentNativeBrowserDriver({
    workspaceRoot: root,
    browserProfilesRoot: path.join(root, "profiles"),
    configuration: AgentBrowserConfigurationSchema.parse({ runtime: { context: "temporary" } }),
    resolveController: () => "test-controller",
    resolveExecutable: () => undefined,
    executeCommand: async ({ command, options }) => {
      commands.push([...command]);
      const value = await handler({ command, options });
      if (value !== undefined) return value;
      if (endsWith(command, ["get", "url"])) return { url: "https://example.com/" };
      if (endsWith(command, ["get", "title"])) return { title: "Example Domain" };
      return {};
    },
  });
  const sessionOptions: AgentBrowserDriverSessionOptions = {
    sessionId: "browser-command-test",
    context: "temporary",
    requestTimeoutMs: 5_000,
    maxDownloadBytes: 128 * 1024,
    assertRequestPermitted: async () => undefined,
  };

  return {
    driver,
    commands,
    sessionOptions,
    dispose: async () => {
      await driver.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

function isLegacyDownloadCommand(command: readonly string[]): boolean {
  return command.at(-2) === "download";
}

function endsWith(command: readonly string[], suffix: readonly string[]): boolean {
  return suffix.every((value, index) => command.at(index - suffix.length) === value);
}

function commandOption(command: readonly string[], option: string): string | undefined {
  const index = command.indexOf(option);
  return index < 0 ? undefined : command[index + 1];
}

function deferred<TValue>() {
  let resolve!: (value: TValue | PromiseLike<TValue>) => void;
  const promise = new Promise<TValue>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
