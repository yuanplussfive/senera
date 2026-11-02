import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DesktopHostIntegrationService,
  resolveDesktopExternalTerminal,
  type DesktopHostIntegrationEffects,
} from "../../../Apps/Desktop/DesktopHostIntegrationService.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

async function createWorkspaceDirectory(): Promise<string> {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "senera-host-integration-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createEffects() {
  const openPath = vi.fn(async (_path: string) => "");
  const spawnDetached = vi.fn(async (_command: string, _args: readonly string[], _cwd: string) => undefined);
  return { effects: { openPath, spawnDetached }, openPath, spawnDetached };
}

function createService(input: {
  workspaceRoot: string | undefined;
  effects: DesktopHostIntegrationEffects;
  platform?: NodeJS.Platform;
  windowsTerminalAvailable?: boolean;
}) {
  return new DesktopHostIntegrationService({
    resolveWorkspaceRoot: () => input.workspaceRoot,
    effects: input.effects,
    platform: input.platform ?? "win32",
    probeExecutable: (command) => input.windowsTerminalAvailable === true && command === "wt.exe",
    resolveShellCommand: () => "pwsh.exe",
  });
}

describe("resolveDesktopExternalTerminal", () => {
  it("prefers Windows Terminal without resolving a shell", () => {
    const resolveShellCommand = vi.fn(() => "pwsh.exe");
    const launch = resolveDesktopExternalTerminal({
      platform: "win32",
      cwd: "C:\\workspace",
      probeExecutable: (command) => command === "wt.exe",
      resolveShellCommand,
    });
    expect(launch).toEqual({
      command: "wt.exe",
      args: ["-d", "C:\\workspace"],
      kind: "windows-terminal",
    });
    expect(resolveShellCommand).not.toHaveBeenCalled();
  });

  it("falls back to the resolved shell when Windows Terminal is absent", () => {
    const launch = resolveDesktopExternalTerminal({
      platform: "win32",
      cwd: "C:\\workspace",
      probeExecutable: () => false,
      resolveShellCommand: () => "pwsh.exe",
    });
    expect(launch).toEqual({ command: "pwsh.exe", args: ["-NoLogo"], kind: "powershell" });
  });

  it("reports no launch strategy outside Windows", () => {
    const launch = resolveDesktopExternalTerminal({
      platform: "darwin",
      cwd: "/workspace",
      probeExecutable: () => true,
      resolveShellCommand: () => "/bin/sh",
    });
    expect(launch).toBeUndefined();
  });
});

describe("DesktopHostIntegrationService", () => {
  it("advertises nothing without a workspace", () => {
    const service = createService({ workspaceRoot: undefined, effects: createEffects().effects });
    expect(service.getCapabilities()).toEqual({ revealWorkspace: false, externalTerminal: false });
  });

  it("advertises workspace reveal and terminal on Windows", () => {
    const service = createService({ workspaceRoot: "C:\\workspace", effects: createEffects().effects });
    expect(service.getCapabilities()).toEqual({ revealWorkspace: true, externalTerminal: true });
  });

  it("hides the terminal action when the platform has no adapter", () => {
    const service = createService({
      workspaceRoot: "/workspace",
      effects: createEffects().effects,
      platform: "linux",
    });
    expect(service.getCapabilities()).toEqual({ revealWorkspace: true, externalTerminal: false });
  });

  it("opens the resolved workspace directory", async () => {
    const workspaceRoot = await createWorkspaceDirectory();
    const { effects, openPath } = createEffects();
    const service = createService({ workspaceRoot, effects });

    await expect(service.revealWorkspace()).resolves.toEqual({ ok: true });
    expect(openPath).toHaveBeenCalledWith(await fs.promises.realpath(workspaceRoot));
  });

  it("reports a missing workspace directory without opening it", async () => {
    const workspaceRoot = await createWorkspaceDirectory();
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true });
    const { effects, openPath } = createEffects();
    const service = createService({ workspaceRoot, effects });

    await expect(service.revealWorkspace()).resolves.toEqual({ ok: false, code: "not-found" });
    expect(openPath).not.toHaveBeenCalled();
  });

  it("surfaces the file manager failure message", async () => {
    const workspaceRoot = await createWorkspaceDirectory();
    const service = createService({
      workspaceRoot,
      effects: {
        openPath: async () => "Access is denied.",
        spawnDetached: async () => undefined,
      },
    });

    await expect(service.revealWorkspace()).resolves.toEqual({
      ok: false,
      code: "failed",
      message: "Access is denied.",
    });
  });

  it("launches the terminal at the workspace root", async () => {
    const workspaceRoot = await createWorkspaceDirectory();
    const { effects, spawnDetached } = createEffects();
    const service = createService({ workspaceRoot, effects, windowsTerminalAvailable: true });

    await expect(service.openExternalTerminal()).resolves.toEqual({ ok: true });
    const resolved = await fs.promises.realpath(workspaceRoot);
    expect(spawnDetached).toHaveBeenCalledWith("wt.exe", ["-d", resolved], resolved);
  });

  it("does not spawn a terminal without a workspace", async () => {
    const { effects, spawnDetached } = createEffects();
    const service = createService({ workspaceRoot: undefined, effects });

    await expect(service.openExternalTerminal()).resolves.toEqual({
      ok: false,
      code: "unavailable",
    });
    expect(spawnDetached).not.toHaveBeenCalled();
  });

  it("surfaces a terminal spawn failure", async () => {
    const workspaceRoot = await createWorkspaceDirectory();
    const service = createService({
      workspaceRoot,
      effects: {
        openPath: async () => "",
        spawnDetached: async () => {
          throw new Error("spawn failed");
        },
      },
    });

    await expect(service.openExternalTerminal()).resolves.toEqual({
      ok: false,
      code: "failed",
      message: "spawn failed",
    });
  });
});
