import { spawn } from "node:child_process";
import { AgentEventKinds, emitAgentEvent } from "../Events/AgentEvent.js";
import type {
  SeneraProcessFallbackAuthorization,
  SeneraProcessFallbackAuthorizer,
} from "./SeneraProcessFallbackAuthorization.js";
import { DenySeneraProcessFallbackAuthorizer } from "./SeneraProcessFallbackAuthorization.js";
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
  type SeneraTerminalFallbackMetadata,
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
  readonly fallbackAuthorizer?: SeneraProcessFallbackAuthorizer;
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
  const fallbackAuthorizer = options.fallbackAuthorizer ?? DenySeneraProcessFallbackAuthorizer;

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
    try {
      const backend = registry.resolve({
        boundary: requestedBoundary,
        requiredCapabilities: spawnOptions.requiredCapabilities,
        shellDialect: spawnOptions.shellCommand?.dialect,
      });
      return decorateTerminalChild(
        await spawnWithTerminalBackend(backend, command, args, spawnOptions),
        createExecutionMetadata(backend.descriptor, requestedBoundary),
      );
    } catch (error) {
      if (requestedBoundary !== "sandbox" || !isSandboxUnavailable(error)) throw error;
      if (profile.localFallback !== "allow" || !profile.fallbackContext) throw error;

      const reason = readTerminalFallbackReason(error);
      const fromBackend = readUnavailableBackend(error) ?? "sandbox-terminal";
      const local = registry.resolve({
        boundary: "local",
        requiredCapabilities: spawnOptions.requiredCapabilities,
        shellDialect: spawnOptions.shellCommand?.dialect,
      });
      const authorization = await fallbackAuthorizer.authorize({
        fromBackend,
        toBackend: local.descriptor.id,
        reason,
        error,
        context: profile.fallbackContext,
        signal: spawnOptions.signal,
      });
      assertSeneraExecutionNotAborted(spawnOptions.signal);
      await emitFallbackStarted(profile.fallbackContext, fromBackend, local.descriptor.id, reason, authorization);
      return decorateTerminalChild(
        await spawnWithTerminalBackend(local, command, args, spawnOptions),
        createExecutionMetadata(local.descriptor, requestedBoundary, {
          reason,
          rule: authorization.rule,
          approvalId: authorization.approvalId,
          scope: authorization.scope,
        }),
      );
    }
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
  fallback?: SeneraTerminalFallbackMetadata,
): SeneraTerminalExecutionMetadata {
  return {
    requestedBoundary,
    effectiveBoundary: descriptor.boundary,
    backendId: descriptor.id,
    shellDialect: descriptor.shellDialect,
    capabilities: [...descriptor.capabilities].sort(),
    capabilityProviders: descriptor.capabilityProviders,
    persistenceScope: descriptor.persistenceScope,
    fallback,
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

function isSandboxUnavailable(error: unknown): error is SeneraExecutionError {
  return error instanceof SeneraExecutionError && error.code === SeneraExecutionErrorCodes.SandboxUnavailable;
}

function definedEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])),
  );
}

function readTerminalFallbackReason(error: SeneraExecutionError): SeneraTerminalFallbackMetadata["reason"] {
  const known = new Set<SeneraTerminalFallbackMetadata["reason"]>([
    "terminal_capability_unsupported",
    "shell_dialect_unsupported",
  ]);
  return known.has(error.details.reason as SeneraTerminalFallbackMetadata["reason"])
    ? (error.details.reason as SeneraTerminalFallbackMetadata["reason"])
    : "sandbox_unavailable";
}

function readUnavailableBackend(error: SeneraExecutionError): string | undefined {
  return typeof error.details.backend === "string" ? error.details.backend : undefined;
}

async function emitFallbackStarted(
  context: NonNullable<NonNullable<Parameters<SeneraTerminalSpawner>[2]["profile"]>["fallbackContext"]>,
  fromBackend: string,
  toBackend: string,
  reason: SeneraTerminalFallbackMetadata["reason"],
  authorization: SeneraProcessFallbackAuthorization,
): Promise<void> {
  await emitAgentEvent(context.onEvent, {
    kind: AgentEventKinds.ExecutionFallbackStarted,
    context: { sessionId: context.sessionId, requestId: context.requestId, step: context.step },
    data: {
      toolCallId: context.toolCallId,
      batchId: context.batchId,
      pluginName: context.subject.pluginName,
      pluginVersion: context.subject.pluginVersion,
      toolName: context.subject.toolName,
      manifestDigest: context.subject.manifestDigest,
      fromBackend,
      toBackend,
      reason,
      rule: authorization.rule,
      approvalId: authorization.approvalId,
      scope: authorization.scope,
    },
  });
}
