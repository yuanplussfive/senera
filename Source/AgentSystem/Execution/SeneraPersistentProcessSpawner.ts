import { SeneraExecutionError, SeneraExecutionErrorCodes } from "./SeneraExecutionTypes.js";
import { assertSeneraExecutionNotAborted } from "./SeneraPersistentExecutionAuthorization.js";
import type { SeneraPersistentProcessChild, SeneraPersistentProcessSpawner } from "./SeneraPersistentProcessTypes.js";
import { SeneraProcessEnvironmentPolicy } from "./SeneraProcessEnvironment.js";
import type { SeneraProcessEnvironmentPolicyOptions } from "./SeneraProcessEnvironment.js";
import { isSeneraShellDialectCompatible, type SeneraShellCommandSpec } from "./SeneraShellCommand.js";
import { resolveSeneraShellInvocation, resolveSeneraShellPlatform } from "./SeneraShellPlatform.js";
import type { SeneraProcessTreeTerminator } from "./SeneraProcessTreeTermination.js";
import { spawnSeneraOwnedProcess, type SeneraOwnedProcess } from "./SeneraOwnedProcessSpawner.js";

type SeneraProcessCloseListener = (exitCode: number | null, signal: NodeJS.Signals | null) => void;

export function createSeneraLocalPersistentProcessSpawner(
  environmentPolicy: SeneraProcessEnvironmentPolicy | SeneraProcessEnvironmentPolicyOptions = {},
  terminateProcessTree?: SeneraProcessTreeTerminator,
): SeneraPersistentProcessSpawner {
  const policy =
    environmentPolicy instanceof SeneraProcessEnvironmentPolicy
      ? environmentPolicy
      : new SeneraProcessEnvironmentPolicy(environmentPolicy);
  return persistentSpawner(["local"], async (command, args, options) => {
    assertSeneraExecutionNotAborted(options.signal);
    const invocation = resolvePersistentProcessInvocation(command, args, options.shellCommand);

    const ownedProcess = await spawnSeneraOwnedProcess(
      invocation.command,
      invocation.args,
      {
        cwd: options.cwd,
        env: policy.project(process.env, options.env),
        windowsHide: options.windowsHide,
      },
      { terminateProcessTree },
    );
    const persistentChild = new SeneraLocalPersistentProcessChild(ownedProcess);
    const child = ownedProcess.child;

    const abort = (): void => {
      void persistentChild.terminateTree("SIGKILL").catch(() => {
        child.kill("SIGKILL");
      });
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    persistentChild.once("close", () => options.signal?.removeEventListener("abort", abort));
    if (options.signal?.aborted) abort();
    return persistentChild;
  });
}

class SeneraLocalPersistentProcessChild implements SeneraPersistentProcessChild {
  constructor(private readonly ownedProcess: SeneraOwnedProcess) {}

  private get child() {
    return this.ownedProcess.child;
  }

  get stdin(): SeneraPersistentProcessChild["stdin"] {
    return this.child.stdin;
  }

  get stdout(): SeneraPersistentProcessChild["stdout"] {
    return this.child.stdout;
  }

  get stderr(): NonNullable<SeneraPersistentProcessChild["stderr"]> {
    return this.child.stderr;
  }

  get pid(): number | undefined {
    return this.ownedProcess.pid;
  }

  get exitCode(): number | null {
    return this.child.exitCode;
  }

  get signalCode(): NodeJS.Signals | null {
    return this.child.signalCode;
  }

  on(event: "error", listener: (error: Error) => void): void;
  on(event: "close", listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void): void;
  on(
    event: "error" | "close",
    listener: ((error: Error) => void) | ((exitCode: number | null, signal: NodeJS.Signals | null) => void),
  ): void {
    if (event === "error") this.child.on(event, listener as (error: Error) => void);
    else this.subscribeToClose(listener as (exitCode: number | null, signal: NodeJS.Signals | null) => void);
  }

  once(event: "close", listener: () => void): void {
    this.subscribeToClose(listener);
  }

  off(event: "close", listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void): void {
    this.closeSubscriptions.get(listener)?.forEach((subscription) => {
      subscription.active = false;
    });
    this.closeSubscriptions.delete(listener);
  }

  kill(signal?: NodeJS.Signals): boolean {
    return this.child.kill(signal);
  }

  async terminateTree(signal: NodeJS.Signals): Promise<void> {
    await this.ownedProcess.terminateTree(signal);
  }

  private readonly closeSubscriptions = new Map<SeneraProcessCloseListener, Set<{ active: boolean }>>();

  private subscribeToClose(listener: SeneraProcessCloseListener): void {
    const subscription = { active: true };
    const subscriptions = this.closeSubscriptions.get(listener) ?? new Set<{ active: boolean }>();
    subscriptions.add(subscription);
    this.closeSubscriptions.set(listener, subscriptions);
    void this.ownedProcess.closed.then(({ exitCode, signal }) => {
      subscriptions.delete(subscription);
      if (subscriptions.size === 0) this.closeSubscriptions.delete(listener);
      if (subscription.active) listener(exitCode, signal);
    });
  }
}

export interface SeneraAuthorizedPersistentProcessSpawnerOptions {
  readonly local?: SeneraPersistentProcessSpawner;
  readonly sandbox?: SeneraPersistentProcessSpawner;
  readonly sandboxEnabled?: boolean;
  readonly environmentPolicy?: SeneraProcessEnvironmentPolicy | SeneraProcessEnvironmentPolicyOptions;
  readonly terminateProcessTree?: SeneraProcessTreeTerminator;
}

export function createSeneraAuthorizedPersistentProcessSpawner(
  options: SeneraAuthorizedPersistentProcessSpawnerOptions = {},
): SeneraPersistentProcessSpawner {
  const local =
    options.local ?? createSeneraLocalPersistentProcessSpawner(options.environmentPolicy, options.terminateProcessTree);
  const supportedBackends = ["local", ...(options.sandbox ? (["sandbox"] as const) : [])] as const;
  return persistentSpawner(supportedBackends, async (command, args, spawnOptions) => {
    if (spawnOptions.signal?.aborted) {
      throw new SeneraExecutionError(SeneraExecutionErrorCodes.Aborted, "aborted");
    }
    if (spawnOptions.profile?.backend === "sandbox") {
      if (options.sandboxEnabled === false || !options.sandbox) {
        throw new SeneraExecutionError(
          SeneraExecutionErrorCodes.SandboxUnavailable,
          "Persistent sandbox execution is unavailable in the active runtime.",
          {
            reason: options.sandboxEnabled === false ? "sandbox_disabled" : "persistent_process_sandbox_unavailable",
            backend: "sandbox-persistent",
            profile: spawnOptions.profile.name,
          },
        );
      }
      return options.sandbox(command, args, spawnOptions);
    }
    return local(command, args, spawnOptions);
  });
}

function resolvePersistentProcessInvocation(
  command: string,
  args: readonly string[],
  shellCommand: SeneraShellCommandSpec | undefined,
): { command: string; args: readonly string[] } {
  if (!shellCommand) return { command, args };
  const shell = resolveSeneraShellPlatform();
  if (!isSeneraShellDialectCompatible(shellCommand.dialect, shell.family)) {
    throw new SeneraExecutionError(
      SeneraExecutionErrorCodes.SpawnFailed,
      `Shell dialect ${shellCommand.dialect} is not supported by the local persistent process backend.`,
      {
        reason: "shell_dialect_unsupported",
        requestedDialect: shellCommand.dialect,
        availableDialect: shell.family,
        backend: "local-persistent",
      },
    );
  }
  return resolveSeneraShellInvocation(shellCommand.script);
}

function persistentSpawner(
  supportedBackends: SeneraPersistentProcessSpawner["supportedBackends"],
  spawn: SeneraPersistentProcessSpawner,
): SeneraPersistentProcessSpawner {
  return Object.assign(spawn, { supportedBackends });
}
