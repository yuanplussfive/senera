import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentBrowserSelection } from "./AgentBrowserConfiguration.js";

export interface AgentBrowserExecutableResolverOptions {
  readonly configuredPath?: string;
  readonly workspaceRoot?: string;
  readonly exists?: (candidate: string) => boolean;
}

export interface AgentBrowserExecutableSelectionResolverOptions extends AgentBrowserExecutableResolverOptions {
  readonly selection?: AgentBrowserSelection;
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
  readonly homeDirectory?: string;
}

export class AgentBrowserExecutableResolutionError extends Error {}

export interface AgentBrowserWindowModeAssertionOptions {
  readonly headed: boolean;
  readonly environment?: NodeJS.ProcessEnv;
}

type AgentBrowserFamily = Exclude<AgentBrowserSelection, "auto" | "bundled">;

const AgentBrowserFamilies: readonly AgentBrowserFamily[] = ["chrome", "edge", "brave", "chromium"];

const AgentBrowserFamilyLabels: Record<AgentBrowserFamily, string> = {
  chrome: "Google Chrome",
  edge: "Microsoft Edge",
  brave: "Brave",
  chromium: "Chromium",
};

/**
 * Resolves an explicitly configured browser executable.
 *
 * This validates a deliberate executable override before it reaches the CLI.
 */
export function resolveAgentBrowserExecutable(options: AgentBrowserExecutableResolverOptions = {}): string {
  const exists = options.exists ?? fs.existsSync;
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const configured = options.configuredPath?.trim();
  if (!configured) {
    throw new AgentBrowserExecutableResolutionError(
      "No explicit browser executable was configured. Leave runtime.executablePath empty so agent-browser can discover a supported browser.",
    );
  }
  const candidate = path.resolve(workspaceRoot, configured);
  if (exists(candidate)) return candidate;
  throw new AgentBrowserExecutableResolutionError(
    `Configured browser executable is unavailable: ${candidate}. Update the controlled browser executable path.`,
  );
}

/**
 * Selects the Chromium executable used for controlled browser sessions.
 *
 * The Senera-managed profile directory is always used, so detecting a system
 * browser never exposes the user's own browser profile or sign-in state.
 */
export function resolveAgentBrowserExecutableSelection(
  options: AgentBrowserExecutableSelectionResolverOptions = {},
): string | undefined {
  const configuredPath = options.configuredPath?.trim();
  if (configuredPath) {
    return resolveAgentBrowserExecutable({
      configuredPath,
      workspaceRoot: options.workspaceRoot,
      exists: options.exists,
    });
  }

  const selection = options.selection ?? "auto";
  if (selection === "bundled") return undefined;

  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const homeDirectory = options.homeDirectory ?? os.homedir();
  const exists = options.exists ?? fs.existsSync;
  const families = selection === "auto" ? AgentBrowserFamilies : [selection];

  for (const family of families) {
    const executable = findBrowserExecutable(family, platform, environment, homeDirectory, exists);
    if (executable) return executable;
  }

  if (selection === "auto") return undefined;
  throw new AgentBrowserExecutableResolutionError(
    `${AgentBrowserFamilyLabels[selection]} was not found on this host. Install it, choose another browser, or set runtime.executablePath.`,
  );
}

function findBrowserExecutable(
  family: AgentBrowserFamily,
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  homeDirectory: string,
  exists: (candidate: string) => boolean,
): string | undefined {
  return browserExecutableCandidates(family, platform, environment, homeDirectory).find(exists);
}

function browserExecutableCandidates(
  family: AgentBrowserFamily,
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  homeDirectory: string,
): string[] {
  const known =
    platform === "win32"
      ? windowsBrowserExecutableCandidates(family, environment, homeDirectory)
      : platform === "darwin"
        ? macOSBrowserExecutableCandidates(family, homeDirectory)
        : linuxBrowserExecutableCandidates(family);
  return uniqueCandidates([...known, ...pathBrowserExecutableCandidates(family, platform, environment)], platform);
}

function windowsBrowserExecutableCandidates(
  family: AgentBrowserFamily,
  environment: NodeJS.ProcessEnv,
  homeDirectory: string,
): string[] {
  const join = path.win32.join;
  const programFiles = environmentValue(environment, "ProgramFiles", "PROGRAMFILES") ?? "C:\\Program Files";
  const programFilesX86 =
    environmentValue(environment, "ProgramFiles(x86)", "PROGRAMFILES(X86)") ?? "C:\\Program Files (x86)";
  const localAppData =
    environmentValue(environment, "LocalAppData", "LOCALAPPDATA") ?? join(homeDirectory, "AppData", "Local");

  switch (family) {
    case "chrome":
      return [
        join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
        join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
        join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      ];
    case "edge":
      return [
        join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
        join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
        join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
      ];
    case "brave":
      return [
        join(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        join(programFilesX86, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        join(localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      ];
    case "chromium":
      return [
        join(localAppData, "Chromium", "Application", "chrome.exe"),
        join(programFiles, "Chromium", "Application", "chrome.exe"),
        join(programFilesX86, "Chromium", "Application", "chrome.exe"),
      ];
  }
}

function macOSBrowserExecutableCandidates(family: AgentBrowserFamily, homeDirectory: string): string[] {
  const join = path.posix.join;
  const application = {
    chrome: ["Google Chrome.app", "Contents", "MacOS", "Google Chrome"],
    edge: ["Microsoft Edge.app", "Contents", "MacOS", "Microsoft Edge"],
    brave: ["Brave Browser.app", "Contents", "MacOS", "Brave Browser"],
    chromium: ["Chromium.app", "Contents", "MacOS", "Chromium"],
  }[family];
  return [join("/Applications", ...application), join(homeDirectory, "Applications", ...application)];
}

function linuxBrowserExecutableCandidates(family: AgentBrowserFamily): string[] {
  switch (family) {
    case "chrome":
      return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome"];
    case "edge":
      return ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable", "/opt/microsoft/msedge/msedge"];
    case "brave":
      return ["/usr/bin/brave-browser", "/opt/brave.com/brave/brave"];
    case "chromium":
      return ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"];
  }
}

function pathBrowserExecutableCandidates(
  family: AgentBrowserFamily,
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
): string[] {
  const names =
    platform === "win32"
      ? {
          chrome: ["chrome.exe"],
          edge: ["msedge.exe"],
          brave: ["brave.exe"],
          chromium: ["chromium.exe"],
        }[family]
      : {
          chrome: ["google-chrome", "google-chrome-stable"],
          edge: ["microsoft-edge", "microsoft-edge-stable"],
          brave: ["brave-browser"],
          chromium: ["chromium", "chromium-browser"],
        }[family];
  const value = environmentValue(environment, "PATH", "Path");
  if (!value) return [];
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  const delimiter = platform === "win32" ? ";" : ":";
  const directories = value
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/u, "$1"))
    .filter(Boolean);
  return directories.flatMap((directory) => names.map((name) => join(directory, name)));
}

function uniqueCandidates(candidates: readonly string[], platform: NodeJS.Platform): string[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = platform === "win32" ? candidate.toLowerCase() : candidate;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function environmentValue(environment: NodeJS.ProcessEnv, ...names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = environment[name]?.trim();
    if (value) return value;
  }
  const normalized = new Map(
    Object.entries(environment)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => [key.toLowerCase(), value!.trim()]),
  );
  for (const name of names) {
    const value = normalized.get(name.toLowerCase());
    if (value) return value;
  }
  return undefined;
}

/**
 * The production image intentionally has no display server. Fail before
 * agent-browser launches so the user can correct the setting instead of seeing a
 * low-level Chromium startup error.
 */
export function assertAgentBrowserWindowModeSupported({
  headed,
  environment = process.env,
}: AgentBrowserWindowModeAssertionOptions): void {
  if (headed && environment.SENERA_CONTAINER === "1") {
    throw new AgentBrowserExecutableResolutionError(
      "Visible controlled-browser windows are unavailable in the container deployment. Set runtime.headed to false, or run Senera on a desktop host.",
    );
  }
}
