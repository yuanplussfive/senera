import { SeneraLocalExecutionEnv } from "./SeneraLocalExecutionEnv.js";
import { SeneraNodeProcessBackend } from "./SeneraNodeProcessBackend.js";
import { SeneraRoutingProcessBackend } from "./SeneraRoutingProcessBackend.js";
import type { SeneraExecutionEnv } from "./SeneraExecutionTypes.js";
import { createSeneraAuthorizedPersistentProcessSpawner } from "./SeneraPersistentProcessSpawner.js";
import type { SeneraResourceAccessAuthorizer } from "./SeneraResourceAccess.js";
import { createSeneraAuthorizedTerminalSpawner } from "./SeneraTerminalSpawner.js";
import { SeneraProcessEnvironmentPolicy } from "./SeneraProcessEnvironment.js";
import type { SeneraProcessEnvironmentPolicyOptions } from "./SeneraProcessEnvironment.js";
import { SeneraDockerEngineBackend } from "./SeneraDockerEngineBackend.js";
import type { SeneraSandboxWorkerClient } from "./SeneraSandboxWorkerTypes.js";
import type { AgentSandboxRuntimeProvider } from "../Sandbox/AgentSandboxRuntimeTypes.js";
import type { SeneraProcessExecutionBackend } from "./SeneraProcessExecutionBackend.js";
import type { SeneraTerminalBackend } from "./SeneraTerminalTypes.js";
import { createSeneraExecutionRuntimeCapabilities } from "./SeneraExecutionRuntimeCapabilities.js";
import { resolveAgentDockerEngineGuestWorkspaceRoot } from "../Sandbox/DockerEngine/AgentDockerEngineRuntimeContract.js";

export interface SeneraExecutionEnvFactoryOptions {
  workspaceRoot: string;
  platform?: NodeJS.Platform;
  resourcesPath?: string;
  resourceAccessPolicy?: SeneraResourceAccessAuthorizer;
  environmentPolicy?: SeneraProcessEnvironmentPolicy | SeneraProcessEnvironmentPolicyOptions;
  terminationGraceMs?: number;
  sandboxAvailable?: boolean;
  sandboxEnabled?: boolean;
  sandboxRuntimeReady?: () => boolean;
  sandboxProvider?: AgentSandboxRuntimeProvider;
  dockerEngineWorker?: SeneraSandboxWorkerClient;
  /** Derived sandbox guest workspace root. Linux paths follow workspaceRoot; other hosts use the contract default. */
  sandboxGuestWorkspaceRoot?: string;
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
  readonly runtimeCapabilities: () => ReturnType<typeof createSeneraExecutionRuntimeCapabilities>;
}

function createSharedExecutionDependencies(options: SeneraExecutionEnvFactoryOptions): SharedExecutionDependencies {
  const platform = options.platform ?? process.platform;
  const sandboxEnabled = options.sandboxEnabled ?? options.sandboxAvailable === true;
  const sandboxAvailable = sandboxEnabled && options.sandboxAvailable === true;
  const environmentPolicy =
    options.environmentPolicy instanceof SeneraProcessEnvironmentPolicy
      ? options.environmentPolicy
      : new SeneraProcessEnvironmentPolicy(options.environmentPolicy);
  const localBackend = new SeneraNodeProcessBackend({
    environmentPolicy,
    terminationGraceMs: options.terminationGraceMs,
  });
  const sandboxProvider = requireDockerEngineProvider(options.sandboxProvider);
  const sandboxGuestWorkspaceRoot =
    options.sandboxGuestWorkspaceRoot ??
    (sandboxAvailable && sandboxProvider
      ? resolveAgentDockerEngineGuestWorkspaceRoot(options.workspaceRoot, sandboxProvider)
      : options.workspaceRoot);
  const sandboxBackend = sandboxAvailable ? createSandboxBackend(options, sandboxGuestWorkspaceRoot) : undefined;
  const processBackend = new SeneraRoutingProcessBackend({
    local: localBackend,
    sandbox: sandboxBackend,
    sandboxEnabled,
  });

  return {
    processBackend,
    persistentProcessSpawner: createSeneraAuthorizedPersistentProcessSpawner({
      environmentPolicy,
      sandbox: sandboxBackend ? sandboxPersistentProcessSpawner(sandboxBackend) : undefined,
      sandboxEnabled,
    }),
    terminalSpawner: createSeneraAuthorizedTerminalSpawner({
      sandbox: isTerminalBackend(sandboxBackend) ? sandboxBackend : undefined,
      sandboxEnabled,
      environmentPolicy,
    }),
    runtimeCapabilities: () => {
      const sandboxReady = Boolean(sandboxBackend) && (options.sandboxRuntimeReady?.() ?? true);
      return createSeneraExecutionRuntimeCapabilities({
        platform,
        sandboxEnabled,
        sandboxProvider: options.sandboxProvider,
        sandboxReady,
        sandboxPersistentProcessReady: sandboxReady && Boolean(sandboxBackend),
        sandboxTerminalReady: sandboxReady && isTerminalBackend(sandboxBackend),
      });
    },
  };
}

function sandboxPersistentProcessSpawner(backend: SeneraDockerEngineBackend) {
  return Object.assign(backend.spawnPersistentProcess.bind(backend), { supportedBackends: ["sandbox"] as const });
}

function createSandboxBackend(options: SeneraExecutionEnvFactoryOptions, sandboxGuestWorkspaceRoot: string) {
  if (!options.dockerEngineWorker) {
    throw new Error(`The selected ${options.sandboxProvider ?? "Docker Engine"} provider requires a Worker client.`);
  }
  return new SeneraDockerEngineBackend({
    workspaceRoot: options.workspaceRoot,
    worker: options.dockerEngineWorker,
    provider: requireDockerEngineProvider(options.sandboxProvider),
    runtimeReady: options.sandboxRuntimeReady,
    guestWorkspaceRoot: sandboxGuestWorkspaceRoot,
  });
}

function requireDockerEngineProvider(
  provider: AgentSandboxRuntimeProvider | undefined,
): Extract<AgentSandboxRuntimeProvider, "gvisor" | "docker-engine"> | undefined {
  return provider;
}

function isTerminalBackend(
  backend: SeneraProcessExecutionBackend | undefined,
): backend is SeneraProcessExecutionBackend & SeneraTerminalBackend {
  if (!backend) return false;
  const candidate = backend as SeneraProcessExecutionBackend & Partial<SeneraTerminalBackend>;
  return candidate.descriptor !== undefined && typeof candidate.spawn === "function";
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
    runtimeCapabilities: dependencies.runtimeCapabilities,
  });
}
