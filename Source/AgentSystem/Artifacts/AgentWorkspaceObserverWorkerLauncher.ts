import { fork, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const resolveLocalModule = createRequire(import.meta.url);

export interface AgentWorkspaceObserverWorkerLaunchOptions {
  readonly parentModuleUrl: string | URL;
  readonly cwd: string;
}

export function launchAgentWorkspaceObserverWorker(options: AgentWorkspaceObserverWorkerLaunchOptions): ChildProcess {
  const workerUrl = resolveAgentWorkspaceObserverWorkerUrl(options.parentModuleUrl);
  return fork(fileURLToPath(workerUrl), [], {
    cwd: options.cwd,
    env: resolveWorkerEnvironment(),
    execArgv: resolveAgentWorkspaceObserverWorkerExecArgv(workerUrl.pathname.endsWith(".ts")),
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    serialization: "advanced",
  });
}

export function resolveAgentWorkspaceObserverWorkerUrl(parentModuleUrl: string | URL): URL {
  const parentUrl = typeof parentModuleUrl === "string" ? new URL(parentModuleUrl) : parentModuleUrl;
  const workerFile = parentUrl.pathname.endsWith(".ts")
    ? "./AgentWorkspaceObserverWorker.ts"
    : "./AgentWorkspaceObserverWorker.js";
  return new URL(workerFile, parentUrl);
}

export function resolveAgentWorkspaceObserverWorkerExecArgv(
  isTypeScript: boolean,
  inheritedExecArgv: readonly string[] = process.execArgv,
): string[] {
  if (!isTypeScript) return [];
  const filtered: string[] = [];
  const valueFlags = new Set(["-e", "--eval", "-p", "--print", "--input-type"]);
  for (let index = 0; index < inheritedExecArgv.length; index += 1) {
    const argument = inheritedExecArgv[index];
    const flag = argument.split("=", 1)[0];
    if (valueFlags.has(argument)) {
      index += 1;
      continue;
    }
    if (valueFlags.has(flag) && argument.includes("=")) continue;
    filtered.push(argument);
  }
  const tsxLoader = pathToFileURL(resolveLocalModule.resolve("tsx")).href;
  return filtered.some((argument) => argument.includes("tsx")) ? filtered : [...filtered, "--import", tsxLoader];
}

function resolveWorkerEnvironment(): NodeJS.ProcessEnv {
  return typeof process.versions.electron === "string" ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" } : process.env;
}
