import { spawn } from "node:child_process";
import { assertSeneraExecutionNotAborted } from "./SeneraPersistentExecutionAuthorization.js";
import { SeneraExecutionError, SeneraExecutionErrorCodes } from "./SeneraExecutionTypes.js";
import { openSeneraTerminalSidecar } from "./SeneraTerminalSidecarClient.js";
import { SeneraNodeTerminalSidecarChannel } from "./SeneraTerminalSidecarChannel.js";
import { resolveSeneraTerminalSidecarRuntime } from "./SeneraTerminalSidecarRuntime.js";
import { SeneraTerminalBackendRegistry } from "./SeneraTerminalBackendRegistry.js";
import { SeneraProcessEnvironmentPolicy } from "./SeneraProcessEnvironment.js";
import type { SeneraProcessEnvironmentPolicyOptions } from "./SeneraProcessEnvironment.js";
import {
  SeneraTerminalCapabilityNames,
  SeneraTerminalCapabilityProviders,
  SeneraTerminalPersistenceScopes,
  type SeneraTerminalBackend,
  type SeneraTerminalChild,
  type SeneraTerminalExecutionMetadata,
  type SeneraTerminalSpawner,
} from "./SeneraTerminalTypes.js";
import { resolveSeneraShellInvocation, resolveSeneraShellPlatform } from "./SeneraShellPlatform.js";

const LocalTerminalCapabilities = new Set([
  SeneraTerminalCapabilityNames.Persistent,
  SeneraTerminalCapabilityNames.InteractiveInput,
  SeneraTerminalCapabilityNames.Resize,
  SeneraTerminalCapabilityNames.Signals,
  SeneraTerminalCapabilityNames.ProcessTreeControl,
]);

const LocalTerminalCapabilityProviders = {
  [SeneraTerminalCapabilityNames.Persistent]: SeneraTerminalCapabilityProviders.HostPty,
  [SeneraTerminalCapabilityNames.InteractiveInput]: SeneraTerminalCapabilityProviders.HostPty,
  [SeneraTerminalCapabilityNames.Resize]: SeneraTerminalCapabilityProviders.HostPty,
  [SeneraTerminalCapabilityNames.Signals]: SeneraTerminalCapabilityProviders.HostPty,
  [SeneraTerminalCapabilityNames.ProcessTreeControl]: SeneraTerminalCapabilityProviders.HostPty,
} as const;

export class SeneraLocalTerminalBackend implements SeneraTerminalBackend {
  readonly descriptor = {
    id: process.platform === "win32" ? "conpty" : "unix-pty",
    boundary: "local",
    shellDialect: resolveSeneraShellPlatform().family,
    capabilities: LocalTerminalCapabilities,
    capabilityProviders: LocalTerminalCapabilityProviders,
    persistenceScope: SeneraTerminalPersistenceScopes.ExecutionResource,
  } as const;

  private readonly environmentPolicy: SeneraProcessEnvironmentPolicy;

  constructor(environmentPolicy: SeneraProcessEnvironmentPolicy | SeneraProcessEnvironmentPolicyOptions = {}) {
    this.environmentPolicy =
      environmentPolicy instanceof SeneraProcessEnvironmentPolicy
        ? environmentPolicy
        : new SeneraProcessEnvironmentPolicy(environmentPolicy);
  }

  resolveShellInvocation(command: string) {
    return resolveSeneraShellInvocation(command);
  }

  async spawn(command: string, args: readonly string[], options: Parameters<SeneraTerminalSpawner>[2]) {
    assertSeneraExecutionNotAborted(options.signal);
    const runtime = resolveSeneraTerminalSidecarRuntime();
    const environment = this.environmentPolicy.project(process.env, options.env);
    const sidecar = spawn(process.execPath, [runtime.entrypoint], {
      cwd: options.cwd,
      env: {
        ...environment,
        ELECTRON_RUN_AS_NODE: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    return openSeneraTerminalSidecar({
      channel: new SeneraNodeTerminalSidecarChannel(sidecar),
      command,
      args,
      cwd: options.cwd,
      env: definedEnvironment(environment),
      columns: options.columns,
      rows: options.rows,
      terminalName: options.name ?? "xterm-256color",
      metadata: createExecutionMetadata(this.descriptor),
      signal: options.signal,
    });
  }
}

export function createSeneraLocalTerminalSpawner(): SeneraTerminalSpawner {
  const backend = new SeneraLocalTerminalBackend();
  return (command, args, options) => backend.spawn(command, args, options);
}

export interface SeneraAuthorizedTerminalSpawnerOptions {
  readonly local?: SeneraTerminalBackend;
  readonly sandbox?: SeneraTerminalBackend;
  readonly backends?: Iterable<SeneraTerminalBackend>;
  readonly environmentPolicy?: SeneraProcessEnvironmentPolicy | SeneraProcessEnvironmentPolicyOptions;
}

export function createSeneraAuthorizedTerminalSpawner(
  options: SeneraAuthorizedTerminalSpawnerOptions = {},
): SeneraTerminalSpawner {
  const registry = new SeneraTerminalBackendRegistry([
    options.local ?? new SeneraLocalTerminalBackend(options.environmentPolicy),
    ...(options.sandbox ? [options.sandbox] : []),
    ...(options.backends ?? []),
  ]);
  return async (command, args, spawnOptions) => {
    assertSeneraExecutionNotAborted(spawnOptions.signal);
    const profile = spawnOptions.profile;
    if (!profile?.backend) {
      throw new SeneraExecutionError(
        SeneraExecutionErrorCodes.SandboxUnavailable,
        "PTY terminal requires an explicit execution boundary.",
        { profile: profile?.name },
      );
    }

    const requestedBoundary = profile.backend;
    const backend = registry.resolve({
      boundary: requestedBoundary,
      requiredCapabilities: spawnOptions.requiredCapabilities,
      shellDialect: spawnOptions.shellCommand?.dialect,
    });
    return decorateTerminalChild(
      await spawnWithTerminalBackend(backend, command, args, spawnOptions),
      createExecutionMetadata(backend.descriptor, requestedBoundary),
    );
  };
}

function spawnWithTerminalBackend(
  backend: SeneraTerminalBackend,
  command: string,
  args: readonly string[],
  options: Parameters<SeneraTerminalSpawner>[2],
): Promise<SeneraTerminalChild> {
  const invocation = options.shellCommand
    ? backend.resolveShellInvocation(options.shellCommand.script)
    : { command, args: [...args] };
  return backend.spawn(invocation.command, invocation.args, options);
}

function createExecutionMetadata(
  descriptor: SeneraTerminalBackend["descriptor"],
  requestedBoundary = descriptor.boundary,
): SeneraTerminalExecutionMetadata {
  return {
    requestedBoundary,
    effectiveBoundary: descriptor.boundary,
    backendId: descriptor.id,
    shellDialect: descriptor.shellDialect,
    capabilities: [...descriptor.capabilities].sort(),
    capabilityProviders: descriptor.capabilityProviders,
    persistenceScope: descriptor.persistenceScope,
  };
}

function decorateTerminalChild(
  child: SeneraTerminalChild,
  routing: SeneraTerminalExecutionMetadata,
): SeneraTerminalChild {
  const resize = child.resize?.bind(child);
  return {
    metadata: {
      ...child.metadata,
      ...routing,
      sandboxId: child.metadata.sandboxId,
    },
    pid: child.pid,
    write: (data) => child.write(data),
    resize: resize ? (columns, rows) => resize(columns, rows) : undefined,
    signal: (signal) => child.signal(signal),
    onData: (listener) => child.onData(listener),
    onError: (listener) => child.onError(listener),
    onExit: (listener) => child.onExit(listener),
  };
}

function definedEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])),
  );
}
