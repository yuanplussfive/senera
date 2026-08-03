import { SeneraLocalExecutionEnv } from "./SeneraLocalExecutionEnv.js";
import { SeneraMicrosandboxBackend } from "./SeneraMicrosandboxBackend.js";
import { SeneraNodeProcessBackend } from "./SeneraNodeProcessBackend.js";
import { SeneraRoutingProcessBackend } from "./SeneraRoutingProcessBackend.js";
import type { SeneraExecutionEnv } from "./SeneraExecutionTypes.js";
import type { SeneraMicrosandboxSettings } from "./SeneraMicrosandboxDefaults.js";
import type { SeneraMicrosandboxSdkAdapter } from "./SeneraMicrosandboxTypes.js";
import type { AgentSandboxRuntimePaths } from "../Sandbox/AgentSandboxRuntimePreparation.js";
import { createSeneraAuthorizedPersistentProcessSpawner } from "./SeneraPersistentProcessSpawner.js";
import type { SeneraResourceAccessAuthorizer } from "./SeneraResourceAccess.js";
import { createSeneraAuthorizedTerminalSpawner } from "./SeneraTerminalSpawner.js";
import { SeneraProcessEnvironmentPolicy } from "./SeneraProcessEnvironment.js";
import type { SeneraProcessEnvironmentPolicyOptions } from "./SeneraProcessEnvironment.js";
import { SeneraGvisorBackend } from "./SeneraGvisorBackend.js";
import type { SeneraGvisorWorkerClient } from "./SeneraGvisorTypes.js";
import { AgentSandboxRuntimeProviders, type AgentSandboxRuntimeProvider } from "../Sandbox/AgentSandboxRuntimeTypes.js";

export interface SeneraExecutionEnvFactoryOptions {
  workspaceRoot: string;
  resourcesPath?: string;
  microsandboxSettings?: Partial<SeneraMicrosandboxSettings>;
  sandboxRuntimePaths?: AgentSandboxRuntimePaths;
  resourceAccessPolicy?: SeneraResourceAccessAuthorizer;
  environmentPolicy?: SeneraProcessEnvironmentPolicy | SeneraProcessEnvironmentPolicyOptions;
  terminationGraceMs?: number;
  sandboxEnabled?: boolean;
  sandboxRuntimeReady?: () => boolean;
  microsandboxSdk?: SeneraMicrosandboxSdkAdapter;
  sandboxProvider?: AgentSandboxRuntimeProvider;
  gvisorWorker?: SeneraGvisorWorkerClient;
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
  const sandboxBackend = createSandboxBackend(options);
  const processBackend = new SeneraRoutingProcessBackend({
    local: localBackend,
    sandbox: sandboxBackend,
    sandboxEnabled: options.sandboxEnabled,
  });

  return {
    processBackend,
    persistentProcessSpawner: createSeneraAuthorizedPersistentProcessSpawner({
      environmentPolicy,
    }),
    terminalSpawner: createSeneraAuthorizedTerminalSpawner({
      sandbox: options.sandboxEnabled === false ? undefined : sandboxBackend,
      sandboxEnabled: options.sandboxEnabled,
      environmentPolicy,
    }),
  };
}

function createSandboxBackend(options: SeneraExecutionEnvFactoryOptions) {
  if (
    options.sandboxProvider === AgentSandboxRuntimeProviders.Gvisor ||
    options.sandboxProvider === AgentSandboxRuntimeProviders.DockerEngine
  ) {
    if (!options.gvisorWorker) {
      throw new Error(`The selected ${options.sandboxProvider} provider requires a Docker Engine worker client.`);
    }
    return new SeneraGvisorBackend({
      workspaceRoot: options.workspaceRoot,
      worker: options.gvisorWorker,
      provider: options.sandboxProvider,
      runtimePaths: options.sandboxRuntimePaths,
      runtimeReady: options.sandboxRuntimeReady,
    });
  }
  return new SeneraMicrosandboxBackend({
    workspaceRoot: options.workspaceRoot,
    settings: options.microsandboxSettings,
    runtimePaths: options.sandboxRuntimePaths,
    runtimeReady: options.sandboxRuntimeReady,
    sdk: options.microsandboxSdk,
  });
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
