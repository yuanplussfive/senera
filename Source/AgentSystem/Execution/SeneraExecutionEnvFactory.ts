import { SeneraLocalExecutionEnv } from "./SeneraLocalExecutionEnv.js";
import { SeneraMicrosandboxBackend } from "./SeneraMicrosandboxBackend.js";
import { SeneraNodeProcessBackend } from "./SeneraNodeProcessBackend.js";
import { SeneraRoutingProcessBackend } from "./SeneraRoutingProcessBackend.js";
import type { SeneraExecutionEnv } from "./SeneraExecutionTypes.js";
import type { SeneraMicrosandboxSettings } from "./SeneraMicrosandboxDefaults.js";
import type { AgentSandboxRuntimePaths } from "../Sandbox/AgentSandboxRuntimePreparation.js";
import { createSeneraAuthorizedPersistentProcessSpawner } from "./SeneraPersistentProcessSpawner.js";
import type { SeneraResourceAccessAuthorizer } from "./SeneraResourceAccess.js";
import { createSeneraAuthorizedTerminalSpawner } from "./SeneraTerminalSpawner.js";
import { SeneraProcessEnvironmentPolicy } from "./SeneraProcessEnvironment.js";
import type { SeneraProcessEnvironmentPolicyOptions } from "./SeneraProcessEnvironment.js";

export interface SeneraExecutionEnvFactoryOptions {
  workspaceRoot: string;
  resourcesPath?: string;
  microsandboxSettings?: Partial<SeneraMicrosandboxSettings>;
  sandboxRuntimePaths?: AgentSandboxRuntimePaths;
  resourceAccessPolicy?: SeneraResourceAccessAuthorizer;
  environmentPolicy?: SeneraProcessEnvironmentPolicy | SeneraProcessEnvironmentPolicyOptions;
  terminationGraceMs?: number;
}

export function createSeneraExecutionEnv(options: SeneraExecutionEnvFactoryOptions): SeneraExecutionEnv {
  return createLocalExecutionEnv(options, createSharedExecutionDependencies(options), options.resourceAccessPolicy);
}

export interface SeneraExecutionEnvironments {
  readonly system: SeneraExecutionEnv;
  readonly tool: SeneraExecutionEnv;
}

export function createSeneraExecutionEnvironments(
  options: SeneraExecutionEnvFactoryOptions,
): SeneraExecutionEnvironments {
  const dependencies = createSharedExecutionDependencies(options);
  return {
    system: createLocalExecutionEnv(options, dependencies),
    tool: createLocalExecutionEnv(options, dependencies, options.resourceAccessPolicy),
  };
}

interface SharedExecutionDependencies {
  readonly processBackend: SeneraRoutingProcessBackend;
  readonly persistentProcessSpawner: ReturnType<typeof createSeneraAuthorizedPersistentProcessSpawner>;
  readonly terminalSpawner: ReturnType<typeof createSeneraAuthorizedTerminalSpawner>;
}

function createSharedExecutionDependencies(options: SeneraExecutionEnvFactoryOptions): SharedExecutionDependencies {
  const environmentPolicy =
    options.environmentPolicy instanceof SeneraProcessEnvironmentPolicy
      ? options.environmentPolicy
      : new SeneraProcessEnvironmentPolicy(options.environmentPolicy);
  const localBackend = new SeneraNodeProcessBackend({
    environmentPolicy,
    terminationGraceMs: options.terminationGraceMs,
  });
  const sandboxBackend = new SeneraMicrosandboxBackend({
    workspaceRoot: options.workspaceRoot,
    settings: options.microsandboxSettings,
    runtimePaths: options.sandboxRuntimePaths,
  });
  const processBackend = new SeneraRoutingProcessBackend({
    local: localBackend,
    sandbox: sandboxBackend,
  });

  return {
    processBackend,
    persistentProcessSpawner: createSeneraAuthorizedPersistentProcessSpawner({
      environmentPolicy,
    }),
    terminalSpawner: createSeneraAuthorizedTerminalSpawner({
      sandbox: sandboxBackend,
      environmentPolicy,
    }),
  };
}

function createLocalExecutionEnv(
  options: SeneraExecutionEnvFactoryOptions,
  dependencies: SharedExecutionDependencies,
  resourceAccessPolicy?: SeneraResourceAccessAuthorizer,
): SeneraExecutionEnv {
  return new SeneraLocalExecutionEnv({
    workspaceRoot: options.workspaceRoot,
    ...dependencies,
    resourceAccessPolicy,
  });
}
