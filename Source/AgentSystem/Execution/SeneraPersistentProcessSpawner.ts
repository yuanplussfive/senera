import { spawn } from "cross-spawn";
import { SeneraExecutionError, SeneraExecutionErrorCodes } from "./SeneraExecutionTypes.js";
import { assertSeneraExecutionNotAborted } from "./SeneraPersistentExecutionAuthorization.js";
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
  readonly environmentPolicy?: SeneraProcessEnvironmentPolicy | SeneraProcessEnvironmentPolicyOptions;
}

export function createSeneraAuthorizedPersistentProcessSpawner(
  options: SeneraAuthorizedPersistentProcessSpawnerOptions = {},
): SeneraPersistentProcessSpawner {
  const local = options.local ?? createSeneraLocalPersistentProcessSpawner(options.environmentPolicy);
  return async (command, args, spawnOptions) => {
    if (spawnOptions.signal?.aborted) {
      throw new SeneraExecutionError(SeneraExecutionErrorCodes.Aborted, "aborted");
    }
    if (spawnOptions.profile?.backend === "sandbox") {
      throw new SeneraExecutionError(
        SeneraExecutionErrorCodes.SandboxUnavailable,
        "长连接 MCP 进程尚未实现沙箱后端。",
        { backend: "microsandbox-persistent", profile: spawnOptions.profile.name },
      );
    }
    return local(command, args, spawnOptions);
  };
}
