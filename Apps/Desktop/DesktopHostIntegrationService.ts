import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { resolveSeneraShellPlatform } from "../../Source/AgentSystem/Execution/SeneraShellPlatform.js";
import {
  DesktopHostIntegrationFailureCodes,
  desktopHostIntegrationFailure,
  type DesktopHostIntegrationCapabilities,
  type DesktopHostIntegrationResult,
} from "./DesktopHostIntegrationProtocol.js";

export const DesktopExternalTerminalKinds = {
  WindowsTerminal: "windows-terminal",
  PowerShell: "powershell",
} as const;

export type DesktopExternalTerminalKind =
  (typeof DesktopExternalTerminalKinds)[keyof typeof DesktopExternalTerminalKinds];

export interface DesktopExternalTerminalLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly kind: DesktopExternalTerminalKind;
}

export interface DesktopHostIntegrationEffects {
  openPath(path: string): Promise<string>;
  spawnDetached(command: string, args: readonly string[], cwd: string): Promise<void>;
}

export interface DesktopHostIntegrationServiceOptions {
  readonly resolveWorkspaceRoot: () => string | undefined;
  readonly effects: DesktopHostIntegrationEffects;
  readonly platform?: NodeJS.Platform;
  readonly probeExecutable?: (command: string) => boolean;
  readonly resolveShellCommand?: () => string;
}

export class DesktopHostIntegrationService {
  private readonly resolveWorkspaceRoot: () => string | undefined;
  private readonly effects: DesktopHostIntegrationEffects;
  private readonly platform: NodeJS.Platform;
  private readonly probeExecutable: (command: string) => boolean;
  private readonly resolveShellCommand: () => string;
  private externalTerminalAvailable?: boolean;

  constructor(options: DesktopHostIntegrationServiceOptions) {
    this.resolveWorkspaceRoot = options.resolveWorkspaceRoot;
    this.effects = options.effects;
    this.platform = options.platform ?? process.platform;
    this.probeExecutable = options.probeExecutable ?? probeDesktopExecutable;
    this.resolveShellCommand = options.resolveShellCommand ?? (() => resolveSeneraShellPlatform().command);
  }

  getCapabilities(): DesktopHostIntegrationCapabilities {
    const workspaceRoot = this.resolveWorkspaceRoot();
    return {
      revealWorkspace: Boolean(workspaceRoot),
      externalTerminal: Boolean(workspaceRoot) && this.supportsExternalTerminal(),
    };
  }

  async revealWorkspace(): Promise<DesktopHostIntegrationResult> {
    const workspaceRoot = this.resolveWorkspaceRoot();
    if (!workspaceRoot) return desktopHostIntegrationFailure(DesktopHostIntegrationFailureCodes.Unavailable);
    const resolved = await resolveWorkspaceDirectory(workspaceRoot);
    if (!resolved) return desktopHostIntegrationFailure(DesktopHostIntegrationFailureCodes.NotFound);
    const error = await this.effects.openPath(resolved);
    return error.trim().length > 0
      ? desktopHostIntegrationFailure(DesktopHostIntegrationFailureCodes.Failed, error)
      : { ok: true };
  }

  async openExternalTerminal(): Promise<DesktopHostIntegrationResult> {
    const workspaceRoot = this.resolveWorkspaceRoot();
    if (!workspaceRoot) return desktopHostIntegrationFailure(DesktopHostIntegrationFailureCodes.Unavailable);
    const resolved = await resolveWorkspaceDirectory(workspaceRoot);
    if (!resolved) return desktopHostIntegrationFailure(DesktopHostIntegrationFailureCodes.NotFound);
    const launch = this.resolveExternalTerminal(resolved);
    if (!launch) return desktopHostIntegrationFailure(DesktopHostIntegrationFailureCodes.Unavailable);
    try {
      await this.effects.spawnDetached(launch.command, launch.args, resolved);
      return { ok: true };
    } catch (error) {
      return desktopHostIntegrationFailure(
        DesktopHostIntegrationFailureCodes.Failed,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private supportsExternalTerminal(): boolean {
    this.externalTerminalAvailable ??= Boolean(
      this.resolveExternalTerminal(this.resolveWorkspaceRoot() ?? process.cwd()),
    );
    return this.externalTerminalAvailable;
  }

  private resolveExternalTerminal(cwd: string): DesktopExternalTerminalLaunch | undefined {
    return resolveDesktopExternalTerminal({
      platform: this.platform,
      cwd,
      probeExecutable: this.probeExecutable,
      resolveShellCommand: this.resolveShellCommand,
    });
  }
}

export function resolveDesktopExternalTerminal(options: {
  platform: NodeJS.Platform;
  cwd: string;
  probeExecutable: (command: string) => boolean;
  resolveShellCommand: () => string;
}): DesktopExternalTerminalLaunch | undefined {
  if (options.platform !== "win32") return undefined;
  if (options.probeExecutable("wt.exe")) {
    return {
      command: "wt.exe",
      args: ["-d", options.cwd],
      kind: DesktopExternalTerminalKinds.WindowsTerminal,
    };
  }
  return {
    command: options.resolveShellCommand(),
    args: ["-NoLogo"],
    kind: DesktopExternalTerminalKinds.PowerShell,
  };
}

const executableAvailability = new Map<string, boolean>();

export function probeDesktopExecutable(command: string): boolean {
  const cached = executableAvailability.get(command);
  if (cached !== undefined) return cached;
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(locator, [command], { stdio: "ignore", windowsHide: true });
  const available = !result.error && result.status === 0;
  executableAvailability.set(command, available);
  return available;
}

export function spawnDesktopProcessDetached(command: string, args: readonly string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function resolveWorkspaceDirectory(workspaceRoot: string): Promise<string | undefined> {
  try {
    const resolved = await fs.promises.realpath(workspaceRoot);
    const stats = await fs.promises.stat(resolved);
    return stats.isDirectory() ? resolved : undefined;
  } catch {
    return undefined;
  }
}
