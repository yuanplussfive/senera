import net from "node:net";
import os from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolveSandboxRuntimeConfig } from "../Source/AgentSystem/AgentDefaults.js";
import { loadConfigFile } from "../Source/AgentSystem/Config/AgentConfigService.js";
import { errorMessage } from "../Source/AgentSystem/Core/AgentErrors.js";
import { sleep } from "../Source/AgentSystem/Core/AgentTiming.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { AgentSandboxRuntimeAvailability } from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimeTypes.js";
import {
  createAgentDockerEngineClient,
  resolveAgentDockerEngineEndpoint,
  resolveAgentSandboxWorkerEndpoint,
} from "../Source/AgentSystem/Sandbox/DockerEngine/AgentDockerEngineEndpoint.js";
import {
  resolveAgentDockerEngineSandboxProvider,
  type AgentDockerWorkspaceSource,
} from "../Source/AgentSystem/Sandbox/DockerEngine/AgentDockerEngineRuntime.js";
import { resolveAgentDockerEngineGuestWorkspaceRoot } from "../Source/AgentSystem/Sandbox/DockerEngine/AgentDockerEngineRuntimeContract.js";
import { AgentSandboxWorkerClient } from "../Source/AgentSystem/Sandbox/Worker/AgentSandboxWorkerClient.js";

export interface SeneraSandboxWorkerProcessOptions {
  workspaceRoot: string;
  configPath?: string;
  config?: AgentSystemConfig;
  entrypoint: string;
  nodeArguments?: readonly string[];
  resourcesPath?: string;
  startupTimeoutMs?: number;
  platform?: NodeJS.Platform;
  /** Container deployments mount a named volume into the guest; desktop uses a host bind path. */
  workspace?: AgentDockerWorkspaceSource;
  /** Guest-side workspace root. Defaults to the derived workspace namespace. */
  guestWorkspaceRoot?: string;
}

export interface SeneraSandboxWorkerBootstrap {
  readonly availability: AgentSandboxRuntimeAvailability;
  readonly client?: AgentSandboxWorkerClient;
  close(): Promise<void>;
}

export async function startSeneraSandboxWorkerProcess(
  options: SeneraSandboxWorkerProcessOptions,
): Promise<SeneraSandboxWorkerBootstrap> {
  const config = resolveSandboxRuntimeConfig(resolveWorkerConfig(options));
  if (!config.Enabled) return disabledBootstrap("configuration-disabled");

  const engineEndpoint = resolveAgentDockerEngineEndpoint({ configuredEndpoint: config.Docker.EngineEndpoint });
  const docker = createAgentDockerEngineClient(engineEndpoint, {
    timeoutMs: config.Docker.DetectionTimeoutSeconds * 1000,
  });
  let resolution: Awaited<ReturnType<typeof resolveAgentDockerEngineSandboxProvider>>;
  try {
    resolution = await resolveAgentDockerEngineSandboxProvider({ docker, preference: config.Provider });
  } catch (error) {
    if (config.Provider !== "auto") {
      throw new Error(`Configured Docker sandbox provider ${config.Provider} is unavailable: ${errorMessage(error)}`, {
        cause: error,
      });
    }
    return disabledBootstrap("docker-engine-unavailable", errorMessage(error));
  }

  const endpoint = resolveAgentSandboxWorkerEndpoint(options.workspaceRoot, config);
  const copySourceRoots = [options.workspaceRoot, options.resourcesPath, os.tmpdir()].filter((value): value is string =>
    Boolean(value),
  );
  if (
    options.workspace?.guestRoot &&
    options.guestWorkspaceRoot &&
    options.workspace.guestRoot !== options.guestWorkspaceRoot
  ) {
    throw new Error("Sandbox Worker workspace guestRoot and guestWorkspaceRoot must agree.");
  }
  const guestWorkspaceRoot =
    options.workspace?.guestRoot ??
    options.guestWorkspaceRoot ??
    resolveAgentDockerEngineGuestWorkspaceRoot(options.workspaceRoot, resolution.provider);
  const workspace: AgentDockerWorkspaceSource & { readonly guestRoot: string } = options.workspace
    ? { ...options.workspace, guestRoot: guestWorkspaceRoot }
    : { kind: "bind", sourcePath: options.workspaceRoot, guestRoot: guestWorkspaceRoot };
  const child = spawn(process.execPath, [...(options.nodeArguments ?? []), options.entrypoint], {
    cwd: options.workspaceRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      SENERA_SANDBOX_WORKER_ENDPOINT: endpoint,
      SENERA_SANDBOX_WORKSPACE_KIND: workspace.kind,
      SENERA_SANDBOX_WORKSPACE_SOURCE: workspace.kind === "bind" ? workspace.sourcePath : workspace.volumeName,
      SENERA_SANDBOX_WORKSPACE_GUEST_ROOT: guestWorkspaceRoot,
      SENERA_SANDBOX_COPY_SOURCE_ROOTS: JSON.stringify(copySourceRoots),
      SENERA_DOCKER_SANDBOX_PROVIDER: resolution.provider,
      SENERA_DOCKER_SANDBOX_IMAGE: config.Docker.Image,
      SENERA_DOCKER_SANDBOX_PULL_POLICY: config.Docker.PullPolicy,
      SENERA_DOCKER_ENGINE_ENDPOINT: engineEndpoint,
    },
    stdio: "inherit",
    windowsHide: true,
  });
  const startupTimeoutMs = options.startupTimeoutMs ?? 10_000;
  try {
    await waitForWorkerEndpoint(child, endpoint, startupTimeoutMs);
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
  const client = new AgentSandboxWorkerClient({ endpoint });
  try {
    const probe = await client.probe({ timeoutMs: startupTimeoutMs });
    if (probe.isolation !== resolution.provider) {
      throw new Error(`Sandbox Worker reported ${probe.isolation}, but startup selected ${resolution.provider}.`);
    }
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
  return {
    availability: { kind: "available", provider: resolution.provider },
    client,
    close: async () => {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await once(child, "exit");
    },
  };
}

function disabledBootstrap(
  reason: Extract<AgentSandboxRuntimeAvailability, { kind: "disabled" }>["reason"],
  detail?: string,
): SeneraSandboxWorkerBootstrap {
  return {
    availability: { kind: "disabled", reason, ...(detail ? { detail } : {}) },
    close: () => Promise.resolve(),
  };
}

function resolveWorkerConfig(options: SeneraSandboxWorkerProcessOptions): AgentSystemConfig {
  if (options.config && options.configPath) {
    throw new Error("Sandbox Worker process accepts either config or configPath, not both.");
  }
  if (options.config) return options.config;
  if (options.configPath) return loadConfigFile(options.configPath);
  throw new Error("Sandbox Worker process requires config or configPath.");
}

async function waitForWorkerEndpoint(child: ChildProcess, endpoint: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`Sandbox Worker exited during startup with code ${child.exitCode}.`);
    try {
      await connectWorkerEndpoint(endpoint, Math.min(250, timeoutMs));
      return;
    } catch (error) {
      if (!isPendingWorkerConnection(error)) throw error;
    }
    await sleep(50, { unref: true });
  }
  throw new Error(`Sandbox Worker did not open its control endpoint within ${timeoutMs}ms.`);
}

async function connectWorkerEndpoint(endpoint: string, timeoutMs: number): Promise<void> {
  const socket = net.createConnection(endpoint);
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      once(socket, "connect"),
      once(socket, "error").then(([error]) => Promise.reject(error)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(new Error("Sandbox Worker connection timed out."), { code: "ETIMEDOUT" })),
          timeoutMs,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    socket.destroy();
  }
}

function isPendingWorkerConnection(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    ["ECONNREFUSED", "ENOENT", "EPIPE", "ETIMEDOUT"].includes(String(error.code))
  );
}
