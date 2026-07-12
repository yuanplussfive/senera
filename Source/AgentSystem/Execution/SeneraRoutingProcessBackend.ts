import {
  DenySeneraProcessFallbackAuthorizer,
  type SeneraProcessFallbackAuthorization,
  type SeneraProcessFallbackAuthorizer,
} from "./SeneraProcessFallbackAuthorization.js";
import type {
  SeneraProcessExecutionBackend,
  SeneraProcessExecutionRequest,
  SeneraProcessShellExecutionRequest,
} from "./SeneraProcessExecutionBackend.js";
import { SeneraExecutionError, SeneraExecutionErrorCodes } from "./SeneraExecutionTypes.js";
import { resolveSeneraShellInvocation } from "./SeneraShellPlatform.js";
import { AgentEventKinds, emitAgentEvent } from "../Events/AgentEvent.js";

export interface SeneraRoutingProcessBackendOptions {
  readonly local: SeneraProcessExecutionBackend;
  readonly sandbox: SeneraProcessExecutionBackend;
  readonly fallbackAuthorizer?: SeneraProcessFallbackAuthorizer;
  readonly onFallbackStarted?: (
    request: SeneraProcessExecutionRequest | SeneraProcessShellExecutionRequest,
    authorization: SeneraProcessFallbackAuthorization,
    fromBackend: string,
    toBackend: string,
  ) => void | Promise<void>;
}

export class SeneraRoutingProcessBackend implements SeneraProcessExecutionBackend {
  readonly kind: string;
  private readonly fallbackAuthorizer: SeneraProcessFallbackAuthorizer;

  constructor(private readonly options: SeneraRoutingProcessBackendOptions) {
    this.kind = `route(local=${options.local.kind},sandbox=${options.sandbox.kind})`;
    this.fallbackAuthorizer = options.fallbackAuthorizer ?? DenySeneraProcessFallbackAuthorizer;
  }

  async executeShellProcess(request: SeneraProcessShellExecutionRequest) {
    return this.executeRouted(request, (backend) => {
      const invocation =
        backend.resolveShellInvocation?.(request.shellCommand) ?? resolveSeneraShellInvocation(request.shellCommand);
      return backend.executeProcess({
        ...request,
        command: invocation.command,
        args: invocation.args,
      });
    });
  }

  async executeProcess(request: SeneraProcessExecutionRequest) {
    return this.executeRouted(request, (backend) => backend.executeProcess(request));
  }

  private async executeRouted<TRequest extends SeneraProcessExecutionRequest | SeneraProcessShellExecutionRequest>(
    request: TRequest,
    execute: (
      backend: SeneraProcessExecutionBackend,
    ) => Promise<Awaited<ReturnType<SeneraProcessExecutionBackend["executeProcess"]>>>,
  ) {
    const profile = request.profile;
    if (!profile?.backend) {
      throw new SeneraExecutionError(SeneraExecutionErrorCodes.SandboxUnavailable, "执行请求缺少明确的后端边界。", {
        profile: profile?.name,
      });
    }
    if (profile.backend === "local") {
      return execute(this.options.local);
    }

    try {
      return await execute(this.options.sandbox);
    } catch (error) {
      if (!isSandboxUnavailable(error)) throw error;
      if (profile.localFallback !== "allow" || !profile.fallbackContext) throw error;

      const authorization = await this.fallbackAuthorizer.authorize({
        fromBackend: this.options.sandbox.kind,
        toBackend: this.options.local.kind,
        reason: "sandbox_unavailable",
        error,
        context: profile.fallbackContext,
        signal: request.signal,
      });
      if (this.options.onFallbackStarted) {
        await this.options.onFallbackStarted(
          request,
          authorization,
          this.options.sandbox.kind,
          this.options.local.kind,
        );
      } else {
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
            fromBackend: this.options.sandbox.kind,
            toBackend: this.options.local.kind,
            reason: "sandbox_unavailable",
            rule: authorization.rule,
            approvalId: authorization.approvalId,
            scope: authorization.scope,
          },
        });
      }
      return execute(this.options.local);
    }
  }
}

function isSandboxUnavailable(error: unknown): error is SeneraExecutionError {
  return error instanceof SeneraExecutionError && error.code === SeneraExecutionErrorCodes.SandboxUnavailable;
}
