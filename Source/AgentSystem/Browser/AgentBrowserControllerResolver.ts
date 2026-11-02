import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

export interface AgentBrowserControllerResolverOptions {
  readonly configuredPath?: string;
  readonly workspaceRoot?: string;
  readonly resourcesPath?: string;
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly exists?: (candidate: string) => boolean;
}

export class AgentBrowserControllerResolutionError extends Error {
  override name = "AgentBrowserControllerResolutionError";
}

/**
 * Resolves the native agent-browser controller shipped by the npm package.
 * The package owns the platform binary names; Senera only resolves the
 * package installation and its Electron unpacked resource location.
 */
export function resolveAgentBrowserController(options: AgentBrowserControllerResolverOptions = {}): string {
  const exists = options.exists ?? fs.existsSync;
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const configured = options.configuredPath?.trim() || options.environment?.AGENT_BROWSER_CONTROLLER_PATH?.trim();
  if (configured) {
    const candidate = path.resolve(workspaceRoot, configured);
    if (exists(candidate)) return candidate;
    throw new AgentBrowserControllerResolutionError(
      `Configured agent-browser controller is unavailable: ${candidate}. Update the controller path or reinstall the package.`,
    );
  }

  const binaryName = agentBrowserControllerBinaryName(
    options.platform ?? process.platform,
    options.arch ?? process.arch,
  );
  const candidates = [
    ...packageBinaryCandidates(binaryName),
    ...resourceBinaryCandidates(options.resourcesPath, binaryName),
  ];
  const controller = candidates.find((candidate) => exists(candidate));
  if (controller) return controller;

  throw new AgentBrowserControllerResolutionError(
    `The native agent-browser controller for ${options.platform ?? process.platform}/${options.arch ?? process.arch} was not found. Install agent-browser ${packageVersionHint()} or configure runtime.controllerPath.`,
  );
}

export function agentBrowserControllerBinaryName(platform: NodeJS.Platform, arch: string): string {
  if (platform === "win32" && (arch === "x64" || arch === "arm64")) return "agent-browser-win32-x64.exe";
  if (platform === "darwin" && arch === "arm64") return "agent-browser-darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "agent-browser-darwin-x64";
  if (platform === "linux" && arch === "arm64") {
    return isMuslRuntime() ? "agent-browser-linux-musl-arm64" : "agent-browser-linux-arm64";
  }
  if (platform === "linux" && arch === "x64") {
    return isMuslRuntime() ? "agent-browser-linux-musl-x64" : "agent-browser-linux-x64";
  }
  throw new AgentBrowserControllerResolutionError(
    `agent-browser does not publish a controller for ${platform}/${arch}.`,
  );
}

function packageBinaryCandidates(binaryName: string): string[] {
  try {
    const require = createRequire(import.meta.url);
    const wrapper = require.resolve("agent-browser/bin/agent-browser.js");
    const packaged = path.resolve(path.dirname(wrapper), binaryName);
    const asarMarker = `${path.sep}app.asar${path.sep}`;
    const asarIndex = packaged.indexOf(asarMarker);
    return asarIndex === -1
      ? [packaged]
      : [
          `${packaged.slice(0, asarIndex)}${path.sep}app.asar.unpacked${packaged.slice(asarIndex + `${path.sep}app.asar`.length)}`,
        ];
  } catch {
    return [];
  }
}

function resourceBinaryCandidates(resourcesPath: string | undefined, binaryName: string): string[] {
  if (!resourcesPath) return [];
  const resourcesRoot = path.resolve(resourcesPath);
  const packageRoot = path.join(resourcesRoot, "node_modules", "agent-browser", "bin");
  return [
    path.join(packageRoot, binaryName),
    path.join(resourcesRoot, "app.asar.unpacked", "node_modules", "agent-browser", "bin", binaryName),
  ];
}

function isMuslRuntime(): boolean {
  if (process.platform !== "linux") return false;
  const report = process.report?.getReport?.() as
    { readonly header?: { readonly glibcVersionRuntime?: string } } | undefined;
  return report?.header?.glibcVersionRuntime === undefined && report?.header !== undefined;
}

function packageVersionHint(): string {
  try {
    const require = createRequire(import.meta.url);
    const packagePath = require.resolve("agent-browser/package.json");
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8")) as { version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version : "the configured version";
  } catch {
    return "the configured version";
  }
}
