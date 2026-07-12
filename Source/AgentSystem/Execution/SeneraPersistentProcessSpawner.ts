import { spawn } from "cross-spawn";
import { AgentEventKinds, emitAgentEvent } from "../Events/AgentEvent.js";
import {
  DenySeneraProcessFallbackAuthorizer,
  type SeneraProcessFallbackAuthorizer,
} from "./SeneraProcessFallbackAuthorization.js";
import { SeneraExecutionError, SeneraExecutionErrorCodes } from "./SeneraExecutionTypes.js";
import type { SeneraPersistentProcessChild, SeneraPersistentProcessSpawner } from "./SeneraPersistentProcessTypes.js";

export function createSeneraLocalPersistentProcessSpawner(): SeneraPersistentProcessSpawner {
  return async (command, args, options) => {
    assertNotAborted(options.signal);

    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: options.windowsHide,
    }) as SeneraPersistentProcessChild;
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
}

export function createSeneraAuthorizedPersistentProcessSpawner(
  options: SeneraAuthorizedPersistentProcessSpawnerOptions = {},
): SeneraPersistentProcessSpawner {
  const local = options.local ?? createSeneraLocalPersistentProcessSpawner();
  const authorizer = options.fallbackAuthorizer ?? DenySeneraProcessFallbackAuthorizer;

  return async (command, args, spawnOptions) => {
    assertNotAborted(spawnOptions.signal);
    const profile = spawnOptions.profile;
    if (!profile?.backend) {
      throw sandboxUnavailable("长连接进程缺少明确的执行边界。", profile?.name);
    }
    if (profile.backend === "local") {
      return local(command, args, spawnOptions);
    }
    if (profile.localFallback !== "allow" || !profile.fallbackContext) {
      throw sandboxUnavailable("当前长连接进程不支持沙箱后端，且执行策略禁止本地回退。", profile.name);
    }

    const unavailable = sandboxUnavailable("当前长连接进程执行边界暂不支持沙箱后端。", profile.name);
    const authorization = await authorizer.authorize({
      fromBackend: "microsandbox-persistent",
      toBackend: "node-persistent",
      reason: "persistent_sandbox_unsupported",
      error: unavailable,
      context: profile.fallbackContext,
      signal: spawnOptions.signal,
    });
    assertNotAborted(spawnOptions.signal);
    const context = profile.fallbackContext;
    await emitAgentEvent(context.onEvent, {
      kind: AgentEventKinds.ExecutionFallbackStarted,
      context: {
        requestId: context.requestId,
        step: context.step,
      },
      data: {
        toolCallId: context.toolCallId,
        pluginName: context.subject.pluginName,
        pluginVersion: context.subject.pluginVersion,
        toolName: context.subject.toolName,
        manifestDigest: context.subject.manifestDigest,
        fromBackend: "microsandbox-persistent",
        toBackend: "node-persistent",
        reason: "persistent_sandbox_unsupported",
        rule: authorization.rule,
        approvalId: authorization.approvalId,
        scope: authorization.scope,
      },
    });
    return local(command, args, spawnOptions);
  };
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new SeneraExecutionError(SeneraExecutionErrorCodes.Aborted, "aborted");
  }
}

function sandboxUnavailable(message: string, profile: string | undefined): SeneraExecutionError {
  return new SeneraExecutionError(SeneraExecutionErrorCodes.SandboxUnavailable, message, {
    backend: "persistent-process",
    profile,
  });
}
