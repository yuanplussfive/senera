import { spawn } from "cross-spawn";
import {
  SeneraExecutionError,
  SeneraExecutionErrorCodes,
} from "./SeneraExecutionTypes.js";
import type {
  SeneraPersistentProcessChild,
  SeneraPersistentProcessSpawner,
  SeneraPersistentProcessSpawnOptions,
} from "./SeneraPersistentProcessTypes.js";

export function createSeneraLocalPersistentProcessSpawner(): SeneraPersistentProcessSpawner {
  return (command, args, options) => {
    assertNotAborted(options.signal);
    assertPersistentLocalBackendAllowed(options);

    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: options.windowsHide,
    }) as SeneraPersistentProcessChild;
    options.signal?.addEventListener("abort", () => {
      child.kill("SIGTERM");
    }, { once: true });
    return child;
  };
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new SeneraExecutionError(SeneraExecutionErrorCodes.Aborted, "aborted");
  }
}

function assertPersistentLocalBackendAllowed(options: SeneraPersistentProcessSpawnOptions): void {
  if (options.profile?.backend === "sandbox" && options.profile.localFallback === "deny") {
    throw new SeneraExecutionError(
      SeneraExecutionErrorCodes.SandboxUnavailable,
      "当前长连接进程执行边界不支持沙箱后端，且执行策略禁止本地回退。",
      {
        backend: "persistent-local",
        profile: options.profile.name,
      },
    );
  }
}
