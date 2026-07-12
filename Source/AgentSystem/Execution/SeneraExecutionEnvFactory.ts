import { SeneraLocalExecutionEnv } from "./SeneraLocalExecutionEnv.js";
import { SeneraMicrosandboxBackend } from "./SeneraMicrosandboxBackend.js";
import { SeneraNodeProcessBackend } from "./SeneraNodeProcessBackend.js";
import { SeneraRoutingProcessBackend } from "./SeneraRoutingProcessBackend.js";
import { createSeneraProcessBackendSpawner } from "./SeneraProcessBackendSpawner.js";
import type { SeneraExecutionEnv } from "./SeneraExecutionTypes.js";
import type { SeneraMicrosandboxSettings } from "./SeneraMicrosandboxDefaults.js";
import type { AgentSandboxRuntimePaths } from "../Sandbox/AgentSandboxRuntimePreparation.js";
import type { SeneraProcessFallbackAuthorizer } from "./SeneraProcessFallbackAuthorization.js";
import { createSeneraAuthorizedPersistentProcessSpawner } from "./SeneraPersistentProcessSpawner.js";

export interface SeneraExecutionEnvFactoryOptions {
  workspaceRoot: string;
  resourcesPath?: string;
  microsandboxSettings?: Partial<SeneraMicrosandboxSettings>;
  sandboxRuntimePaths?: AgentSandboxRuntimePaths;
  fallbackAuthorizer?: SeneraProcessFallbackAuthorizer;
}

export function createSeneraExecutionEnv(options: SeneraExecutionEnvFactoryOptions): SeneraExecutionEnv {
  const localBackend = new SeneraNodeProcessBackend();
  const sandboxBackend = new SeneraMicrosandboxBackend({
    workspaceRoot: options.workspaceRoot,
    settings: options.microsandboxSettings,
    runtimePaths: options.sandboxRuntimePaths,
  });
  const processBackend = new SeneraRoutingProcessBackend({
    local: localBackend,
    sandbox: sandboxBackend,
    fallbackAuthorizer: options.fallbackAuthorizer,
  });

  return new SeneraLocalExecutionEnv({
    workspaceRoot: options.workspaceRoot,
    processBackend,
    processSpawner: createSeneraProcessBackendSpawner(processBackend),
    persistentProcessSpawner: createSeneraAuthorizedPersistentProcessSpawner({
      fallbackAuthorizer: options.fallbackAuthorizer,
    }),
  });
}
