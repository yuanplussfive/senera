import { SeneraLocalExecutionEnv } from "./SeneraLocalExecutionEnv.js";
import { SeneraFallbackProcessBackend } from "./SeneraFallbackProcessBackend.js";
import { SeneraMicrosandboxBackend } from "./SeneraMicrosandboxBackend.js";
import { SeneraNodeProcessBackend } from "./SeneraNodeProcessBackend.js";
import { createSeneraProcessBackendSpawner } from "./SeneraProcessBackendSpawner.js";
import type { SeneraExecutionEnv } from "./SeneraExecutionTypes.js";
import type { SeneraMicrosandboxSettings } from "./SeneraMicrosandboxDefaults.js";
import type { AgentSandboxRuntimePaths } from "../Sandbox/AgentSandboxRuntimePreparation.js";

export interface SeneraExecutionEnvFactoryOptions {
  workspaceRoot: string;
  resourcesPath?: string;
  microsandboxSettings?: Partial<SeneraMicrosandboxSettings>;
  sandboxRuntimePaths?: AgentSandboxRuntimePaths;
}

export function createSeneraExecutionEnv(
  options: SeneraExecutionEnvFactoryOptions,
): SeneraExecutionEnv {
  const shellBackend = new SeneraFallbackProcessBackend([
    new SeneraMicrosandboxBackend({
      workspaceRoot: options.workspaceRoot,
      settings: options.microsandboxSettings,
      runtimePaths: options.sandboxRuntimePaths,
    }),
    new SeneraNodeProcessBackend(),
  ]);
  const pluginBackend = new SeneraFallbackProcessBackend([
    new SeneraMicrosandboxBackend({
      workspaceRoot: options.workspaceRoot,
      settings: options.microsandboxSettings,
      runtimePaths: options.sandboxRuntimePaths,
    }),
    new SeneraNodeProcessBackend(),
  ]);

  return new SeneraLocalExecutionEnv({
    workspaceRoot: options.workspaceRoot,
    processBackend: shellBackend,
    processSpawner: createSeneraProcessBackendSpawner(pluginBackend),
  });
}
