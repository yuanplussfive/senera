import fs from "node:fs";
import os from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolveSandboxRuntimeConfig } from "../Source/AgentSystem/AgentDefaults.js";
import { loadConfigFile } from "../Source/AgentSystem/Config/AgentConfigService.js";
import { canAccessLinuxKvm } from "../Source/AgentSystem/Sandbox/AgentSandboxProviderSelection.js";
import {
  AgentSandboxRuntimeProviders,
  type AgentSandboxRuntimeProvider,
} from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimeTypes.js";
import { resolveAgentGvisorWorkerSocketPath } from "../Source/AgentSystem/Sandbox/Gvisor/AgentGvisorRuntimePreparation.js";
import { AgentGvisorWorkerSocketClient } from "../Source/AgentSystem/Sandbox/Gvisor/AgentGvisorWorkerClient.js";
import { sleep } from "../Source/AgentSystem/Core/AgentTiming.js";

export interface SeneraGvisorWorkerProcessOptions {
  workspaceRoot: string;
  configPath: string;
  entrypoint: string;
  nodeArguments?: readonly string[];
  resourcesPath?: string;
  startupTimeoutMs?: number;
}

export interface SeneraGvisorWorkerProcess {
  readonly provider: Extract<AgentSandboxRuntimeProvider, "gvisor" | "docker-engine">;
  readonly client: AgentGvisorWorkerSocketClient;
  close(): Promise<void>;
}

export async function startSeneraGvisorWorkerProcess(
  options: SeneraGvisorWorkerProcessOptions,
): Promise<SeneraGvisorWorkerProcess | undefined> {
  const config = resolveSandboxRuntimeConfig(loadConfigFile(options.configPath));
  if (!config.Enabled) return undefined;
  if (config.Provider === AgentSandboxRuntimeProviders.Microsandbox) return undefined;
  if (process.platform !== "linux") {
    if (config.Provider === "auto") return undefined;
    throw new Error(`${config.Provider} sandbox provider requires Linux; current platform is ${process.platform}.`);
  }
  if (config.Provider === "auto" && canAccessLinuxKvm()) return undefined;

  const socketPath = resolveAgentGvisorWorkerSocketPath(options.workspaceRoot, config);
  const copySourceRoots = [options.workspaceRoot, options.resourcesPath, os.tmpdir()].filter((value): value is string =>
    Boolean(value),
  );
  const child = spawn(process.execPath, [...(options.nodeArguments ?? []), options.entrypoint], {
    cwd: options.workspaceRoot,
    env: {
      ...process.env,
      SENERA_GVISOR_WORKER_SOCKET: socketPath,
      SENERA_GVISOR_WORKSPACE_KIND: "bind",
      SENERA_GVISOR_WORKSPACE_SOURCE: options.workspaceRoot,
      SENERA_GVISOR_COPY_SOURCE_ROOTS: JSON.stringify(copySourceRoots),
      SENERA_DOCKER_SANDBOX_PROVIDER: config.Provider,
    },
    stdio: "inherit",
    windowsHide: true,
  });
  try {
    await waitForWorkerSocket(child, socketPath, options.startupTimeoutMs ?? 10_000);
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
  const client = new AgentGvisorWorkerSocketClient({ socketPath });
  let probe: Awaited<ReturnType<AgentGvisorWorkerSocketClient["probe"]>>;
  try {
    probe = await client.probe({ timeoutMs: options.startupTimeoutMs ?? 10_000 });
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
  return {
    provider: probe.isolation,
    client,
    close: async () => {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await once(child, "exit");
    },
  };
}

async function waitForWorkerSocket(child: ChildProcess, socketPath: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`gVisor worker exited during startup with code ${child.exitCode}.`);
    try {
      if (fs.statSync(socketPath).isSocket()) return;
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    await sleep(50, { unref: true });
  }
  throw new Error(`gVisor worker did not create its control socket within ${timeoutMs}ms.`);
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
