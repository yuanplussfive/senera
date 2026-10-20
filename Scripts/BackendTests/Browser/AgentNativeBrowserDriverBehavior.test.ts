import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { AgentBrowserConfigurationSchema } from "../../../Source/AgentSystem/Browser/AgentBrowserConfiguration.js";
import { serializeError } from "../../../Source/AgentSystem/Diagnostics/AgentErrorSerializer.js";
import type { AgentBrowserDriverSessionOptions } from "../../../Source/AgentSystem/Browser/AgentBrowserDriver.js";
import {
  AgentNativeBrowserCommandError,
  AgentNativeBrowserDriver,
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
      expect(fixture.commands.some((command) => command.includes("download"))).toBe(true);
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
      const fixture = await createDownloadFixture({ href });
      try {
        const session = await fixture.driver.createSession(fixture.sessionOptions);
        const result = await session.execute("download", { selector: "@e4" }, { timeoutMs: 5_000 });

        expect(fixture.assertRequestPermitted).not.toHaveBeenCalled();
        expect(fixture.commands.some((command) => command.includes("download"))).toBe(true);
        expect(result.download).toMatchObject({ data: Buffer.from("id,total\n1,42\n"), fileName: "download" });
        expect(result.download?.url).toBeUndefined();
      } finally {
        await fixture.dispose();
      }
    },
  );
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

async function createDownloadFixture(input: { readonly href?: string; readonly download?: string }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-native-browser-"));
  const commands: string[][] = [];
  const assertRequestPermitted = vi.fn(async () => undefined);
  const driver = new AgentNativeBrowserDriver({
    workspaceRoot: root,
    configuration: AgentBrowserConfigurationSchema.parse({ runtime: { context: "temporary" } }),
    resolveController: () => "test-controller",
    executeCommand: async ({ command }) => {
      const recorded = [...command];
      commands.push(recorded);
      if (endsWith(recorded, ["get", "url"])) return { url: "https://example.com/reports" };
      if (endsWith(recorded, ["get", "title"])) return { title: "Reports" };
      if (endsWith(recorded, ["get", "attr", "@e4", "href"])) return { value: input.href };
      if (endsWith(recorded, ["get", "attr", "@e4", "download"])) return { value: input.download };
      const downloadIndex = recorded.lastIndexOf("download");
      if (downloadIndex >= 0) {
        await fs.writeFile(recorded[downloadIndex + 2]!, "id,total\n1,42\n");
        return { saved: true };
      }
      return {};
    },
  });
  const sessionOptions: AgentBrowserDriverSessionOptions = {
    sessionId: "browser-download-test",
    requestTimeoutMs: 5_000,
    maxDownloadBytes: 128 * 1024,
    assertRequestPermitted,
  };

  return {
    driver,
    commands,
    assertRequestPermitted,
    sessionOptions,
    dispose: async () => {
      await driver.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
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
