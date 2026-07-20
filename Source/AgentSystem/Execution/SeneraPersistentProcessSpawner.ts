import { spawn } from "cross-spawn";
import type { SeneraProcessFallbackAuthorizer } from "./SeneraProcessFallbackAuthorization.js";
import {
  assertSeneraExecutionNotAborted,
  runAuthorizedPersistentExecution,
} from "./SeneraPersistentExecutionAuthorization.js";
import type { SeneraPersistentProcessChild, SeneraPersistentProcessSpawner } from "./SeneraPersistentProcessTypes.js";
import { SeneraProcessEnvironmentPolicy } from "./SeneraProcessEnvironment.js";
import type { SeneraProcessEnvironmentPolicyOptions } from "./SeneraProcessEnvironment.js";

export function createSeneraLocalPersistentProcessSpawner(
  environmentPolicy: SeneraProcessEnvironmentPolicy | SeneraProcessEnvironmentPolicyOptions = {},
): SeneraPersistentProcessSpawner {
  const policy =
    environmentPolicy instanceof SeneraProcessEnvironmentPolicy
      ? environmentPolicy
      : new SeneraProcessEnvironmentPolicy(environmentPolicy);
  return async (command, args, options) => {
    assertSeneraExecutionNotAborted(options.signal);

    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: policy.project(process.env, options.env),
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: options.windowsHide,
    }) as unknown as SeneraPersistentProcessChild;
    options.signal?.addEventListener(
      "abort",
      () => {
        child.kill("SIGTERM");
      },
      { once: true },
    );
    return child;
  };
}

export interface SeneraAuthorizedPersistentProcessSpawnerOptions {
  readonly local?: SeneraPersistentProcessSpawner;
  readonly fallbackAuthorizer?: SeneraProcessFallbackAuthorizer;
  readonly environmentPolicy?: SeneraProcessEnvironmentPolicy | SeneraProcessEnvironmentPolicyOptions;
}

export function createSeneraAuthorizedPersistentProcessSpawner(
  options: SeneraAuthorizedPersistentProcessSpawnerOptions = {},
): SeneraPersistentProcessSpawner {
  const local = options.local ?? createSeneraLocalPersistentProcessSpawner(options.environmentPolicy);
  return (command, args, spawnOptions) =>
    runAuthorizedPersistentExecution({
      profile: spawnOptions.profile,
      signal: spawnOptions.signal,
      fallbackAuthorizer: options.fallbackAuthorizer,
      localBackend: "node-persistent",
      sandboxBackend: "microsandbox-persistent",
      capability: "长连接进程",
      startLocal: () => local(command, args, spawnOptions),
    });
}
