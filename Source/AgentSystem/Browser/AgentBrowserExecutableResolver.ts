import fs from "node:fs";
import path from "node:path";

export interface AgentBrowserExecutableResolverOptions {
  readonly configuredPath?: string;
  readonly workspaceRoot?: string;
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
  readonly exists?: (candidate: string) => boolean;
}

export class AgentBrowserExecutableResolutionError extends Error {}

export interface AgentBrowserWindowModeAssertionOptions {
  readonly headed: boolean;
  readonly environment?: NodeJS.ProcessEnv;
}

/**
 * Resolves a Chromium-family browser that Playwright can launch without
 * depending on a bundled browser download. A configured path always wins;
 * platform discovery is only a zero-configuration fallback.
 */
export function resolveAgentBrowserExecutable(options: AgentBrowserExecutableResolverOptions = {}): string {
  const exists = options.exists ?? fs.existsSync;
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const configured = options.configuredPath?.trim();
  if (configured) {
    const candidate = path.resolve(workspaceRoot, configured);
    if (exists(candidate)) return candidate;
    throw new AgentBrowserExecutableResolutionError(
      `Configured browser executable is unavailable: ${candidate}. Update the controlled browser executable path.`,
    );
  }

  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const candidates = [
    ...platformBrowserCandidates(platform, environment),
    ...pathBrowserCandidates(platform, environment),
  ];
  const browser = candidates.find((candidate) => exists(candidate));
  if (browser) return browser;

  throw new AgentBrowserExecutableResolutionError(
    "No compatible Chromium browser was found. Install Chrome, Edge, or Chromium, or configure the controlled browser executable path.",
  );
}

/**
 * The production image intentionally has no display server. Fail before
 * Playwright launches so the user can correct the setting instead of seeing a
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

function platformBrowserCandidates(platform: NodeJS.Platform, environment: NodeJS.ProcessEnv): string[] {
  if (platform === "win32") {
    const roots = [environment.ProgramFiles, environment["ProgramFiles(x86)"], environment.LOCALAPPDATA].filter(
      (value): value is string => Boolean(value),
    );
    return roots.flatMap((root) => [
      path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(root, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    ]);
  }
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
}

function pathBrowserCandidates(platform: NodeJS.Platform, environment: NodeJS.ProcessEnv): string[] {
  const names =
    platform === "win32"
      ? ["chrome.exe", "msedge.exe", "brave.exe", "chromium.exe"]
      : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"];
  const pathVariable = environment.PATH ?? environment.Path;
  if (!pathVariable) return [];
  return pathVariable
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((directory) => names.map((name) => path.join(directory, name)));
}
