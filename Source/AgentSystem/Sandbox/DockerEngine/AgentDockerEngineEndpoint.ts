import { createHash } from "node:crypto";
import path from "node:path";
import Docker from "dockerode";
import type { ResolvedAgentSandboxRuntimeConfig } from "../../Types/AgentConfigTypes.js";
import { resolveAgentSandboxRuntimePaths } from "../AgentSandboxRuntimePreparation.js";

const WindowsDockerDesktopPipe = "\\\\.\\pipe\\docker_engine";

export interface AgentDockerEngineEndpointResolutionOptions {
  configuredEndpoint?: string;
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export interface AgentDockerEngineClientOptions {
  timeoutMs?: number;
}

/** Resolves the Docker Engine endpoint without mutating process environment. */
export function resolveAgentDockerEngineEndpoint(options: AgentDockerEngineEndpointResolutionOptions = {}): string {
  const environment = options.environment ?? process.env;
  const configured = options.configuredEndpoint?.trim() || environment.DOCKER_HOST?.trim();
  if (configured) return normalizeDockerEngineEndpoint(configured);
  return (options.platform ?? process.platform) === "win32" ? WindowsDockerDesktopPipe : "/var/run/docker.sock";
}

export function createAgentDockerEngineClient(endpoint: string, options: AgentDockerEngineClientOptions = {}): Docker {
  const timeout = options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs };
  if (isWindowsNamedPipe(endpoint) || path.isAbsolute(endpoint))
    return new Docker({ socketPath: endpoint, ...timeout });

  const url = new URL(endpoint);
  if (url.protocol === "unix:") return new Docker({ socketPath: decodeURIComponent(url.pathname), ...timeout });
  if (url.protocol === "npipe:") return new Docker({ socketPath: normalizeWindowsNamedPipe(url), ...timeout });
  if (!["tcp:", "http:", "https:"].includes(url.protocol)) {
    throw new Error(`Unsupported Docker Engine endpoint protocol: ${url.protocol}`);
  }
  if (!url.hostname || !url.port) throw new Error(`Docker Engine endpoint must include host and port: ${endpoint}`);
  return new Docker({
    protocol: url.protocol === "https:" ? "https" : "http",
    host: url.hostname,
    port: Number.parseInt(url.port, 10),
    ...timeout,
  });
}

export interface AgentSandboxWorkerEndpointResolutionOptions {
  platform?: NodeJS.Platform;
  processId?: number;
}

export function resolveAgentSandboxWorkerEndpoint(
  workspaceRoot: string,
  config: Pick<ResolvedAgentSandboxRuntimeConfig, "BaseDir" | "Docker">,
  options: AgentSandboxWorkerEndpointResolutionOptions = {},
): string {
  const platform = options.platform ?? process.platform;
  const configured = config.Docker.WorkerEndpoint?.trim();
  if (configured) {
    if (platform === "win32") {
      if (!isWindowsNamedPipe(configured)) {
        throw new Error("A Windows sandbox Worker endpoint must be a named pipe path.");
      }
      return normalizeWindowsNamedPipePath(configured);
    }
    return path.isAbsolute(configured)
      ? path.normalize(configured)
      : path.resolve(resolveAgentSandboxRuntimePaths(workspaceRoot, config).baseDir, configured);
  }

  const processId = options.processId ?? process.pid;
  if (platform === "win32") {
    const workspaceId = createHash("sha256")
      .update(path.resolve(workspaceRoot).toLowerCase())
      .digest("hex")
      .slice(0, 16);
    return `\\\\.\\pipe\\senera-sandbox-${workspaceId}-${processId}`;
  }
  return path.join(resolveAgentSandboxRuntimePaths(workspaceRoot, config).baseDir, `worker-${processId}.sock`);
}

function normalizeDockerEngineEndpoint(endpoint: string): string {
  if (isWindowsNamedPipe(endpoint)) return normalizeWindowsNamedPipePath(endpoint);
  if (path.isAbsolute(endpoint)) return path.normalize(endpoint);
  const protocol = new URL(endpoint).protocol;
  if (!["unix:", "npipe:", "tcp:", "http:", "https:"].includes(protocol)) {
    throw new Error(`Unsupported Docker Engine endpoint protocol: ${protocol}`);
  }
  return endpoint;
}

function isWindowsNamedPipe(value: string): boolean {
  return value.startsWith("\\\\.\\pipe\\") || value.startsWith("//./pipe/");
}

function normalizeWindowsNamedPipePath(value: string): string {
  return value.startsWith("//./pipe/") ? `\\\\.\\pipe\\${value.slice("//./pipe/".length)}` : value;
}

function normalizeWindowsNamedPipe(url: URL): string {
  const value = `${url.hostname}${decodeURIComponent(url.pathname)}`.replaceAll("/", "\\");
  const pipeIndex = value.toLowerCase().indexOf("pipe\\");
  if (pipeIndex < 0) throw new Error(`Invalid Docker named pipe endpoint: ${url.href}`);
  return `\\\\.\\${value.slice(pipeIndex)}`;
}
