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
import { isSeneraShellDialectCompatible } from "./SeneraShellCommand.js";

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
    return this.executeRouted(request, (backend, boundary) => {
      assertShellDialect(backend, boundary, request);
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
      boundary: "local" | "sandbox",
    ) => Promise<Awaited<ReturnType<SeneraProcessExecutionBackend["executeProcess"]>>>,
  ) {
    const profile = request.profile;
    if (!profile?.backend) {
      throw new SeneraExecutionError(SeneraExecutionErrorCodes.SandboxUnavailable, "执行请求缺少明确的后端边界。", {
        profile: profile?.name,
      });
    }
    if (profile.backend === "local") {
      return execute(this.options.local, "local");
    }

    try {
      return await execute(this.options.sandbox, "sandbox");
    } catch (error) {
      if (!isSandboxUnavailable(error)) throw error;
      if (profile.localFallback !== "allow" || !profile.fallbackContext) throw error;

      const authorization = await this.fallbackAuthorizer.authorize({
        fromBackend: this.options.sandbox.kind,
        toBackend: this.options.local.kind,
        reason: readProcessFallbackReason(error),
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
            fromBackend: this.options.sandbox.kind,
            toBackend: this.options.local.kind,
            reason: readProcessFallbackReason(error),
            rule: authorization.rule,
            approvalId: authorization.approvalId,
            scope: authorization.scope,
          },
        });
      }
      return execute(this.options.local, "local");
    }
  }
}

function assertShellDialect(
  backend: SeneraProcessExecutionBackend,
  boundary: "local" | "sandbox",
  request: SeneraProcessShellExecutionRequest,
): void {
  const available = backend.shellDialect;
  if (available && isSeneraShellDialectCompatible(request.shellDialect, available)) return;
  throw new SeneraExecutionError(
    boundary === "sandbox" ? SeneraExecutionErrorCodes.SandboxUnavailable : SeneraExecutionErrorCodes.SpawnFailed,
    `Shell dialect ${request.shellDialect} is not supported by backend ${backend.kind}.`,
    {
      reason: "shell_dialect_unsupported",
      requestedDialect: request.shellDialect,
      availableDialect: available,
      backend: backend.kind,
    },
  );
}

function readProcessFallbackReason(error: SeneraExecutionError): "sandbox_unavailable" | "shell_dialect_unsupported" {
  return error.details.reason === "shell_dialect_unsupported" ? "shell_dialect_unsupported" : "sandbox_unavailable";
}

function isSandboxUnavailable(error: unknown): error is SeneraExecutionError {
  return error instanceof SeneraExecutionError && error.code === SeneraExecutionErrorCodes.SandboxUnavailable;
}
