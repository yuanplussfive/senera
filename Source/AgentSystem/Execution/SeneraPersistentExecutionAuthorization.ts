import { AgentEventKinds, emitAgentEvent } from "../Events/AgentEvent.js";
import {
  DenySeneraProcessFallbackAuthorizer,
  type SeneraProcessFallbackAuthorizer,
} from "./SeneraProcessFallbackAuthorization.js";
import type { SeneraProcessExecutionProfile } from "./SeneraExecutionProfile.js";
import { SeneraExecutionError, SeneraExecutionErrorCodes } from "./SeneraExecutionTypes.js";

export interface SeneraPersistentExecutionAuthorizationOptions<TResult> {
  profile?: SeneraProcessExecutionProfile;
  signal?: AbortSignal;
  fallbackAuthorizer?: SeneraProcessFallbackAuthorizer;
  localBackend: string;
  sandboxBackend: string;
  capability: string;
  startLocal: () => Promise<TResult>;
}

export async function runAuthorizedPersistentExecution<TResult>(
  options: SeneraPersistentExecutionAuthorizationOptions<TResult>,
): Promise<TResult> {
  assertSeneraExecutionNotAborted(options.signal);
  const profile = options.profile;
  if (!profile?.backend) {
    throw sandboxUnavailable(`${options.capability}缺少明确的执行边界。`, profile?.name, options.capability);
  }
  if (profile.backend === "local") {
    return options.startLocal();
  }
  if (profile.localFallback !== "allow" || !profile.fallbackContext) {
    throw sandboxUnavailable(
      `${options.capability}暂不支持沙箱后端，且执行策略禁止本地回退。`,
      profile.name,
      options.capability,
    );
  }

  const unavailable = sandboxUnavailable(
    `${options.capability}执行边界暂不支持沙箱后端。`,
    profile.name,
    options.capability,
  );
  const authorizer = options.fallbackAuthorizer ?? DenySeneraProcessFallbackAuthorizer;
  const authorization = await authorizer.authorize({
    fromBackend: options.sandboxBackend,
    toBackend: options.localBackend,
    reason: "persistent_sandbox_unsupported",
    error: unavailable,
    context: profile.fallbackContext,
    signal: options.signal,
  });
  assertSeneraExecutionNotAborted(options.signal);
  const context = profile.fallbackContext;
  await emitAgentEvent(context.onEvent, {
    kind: AgentEventKinds.ExecutionFallbackStarted,
    context: {
      sessionId: context.sessionId,
      requestId: context.requestId,
      step: context.step,
    },
    data: {
      toolCallId: context.toolCallId,
      batchId: context.batchId,
      pluginName: context.subject.pluginName,
      pluginVersion: context.subject.pluginVersion,
      toolName: context.subject.toolName,
      manifestDigest: context.subject.manifestDigest,
      fromBackend: options.sandboxBackend,
      toBackend: options.localBackend,
      reason: "persistent_sandbox_unsupported",
      rule: authorization.rule,
      approvalId: authorization.approvalId,
      scope: authorization.scope,
    },
  });
  return options.startLocal();
}

export function assertSeneraExecutionNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new SeneraExecutionError(SeneraExecutionErrorCodes.Aborted, "aborted");
  }
}

function sandboxUnavailable(message: string, profile: string | undefined, capability: string): SeneraExecutionError {
  return new SeneraExecutionError(SeneraExecutionErrorCodes.SandboxUnavailable, message, {
    backend: capability,
    profile,
  });
}
