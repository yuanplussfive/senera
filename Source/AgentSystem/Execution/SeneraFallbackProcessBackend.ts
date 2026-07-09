import {
  SeneraExecutionError,
  SeneraExecutionErrorCodes,
} from "./SeneraExecutionTypes.js";
import type {
  SeneraProcessExecutionBackend,
  SeneraProcessExecutionRequest,
  SeneraProcessShellExecutionRequest,
} from "./SeneraProcessExecutionBackend.js";
import { resolveSeneraShellInvocation } from "./SeneraShellPlatform.js";

export class SeneraFallbackProcessBackend implements SeneraProcessExecutionBackend {
  readonly kind: string;

  constructor(private readonly backends: readonly SeneraProcessExecutionBackend[]) {
    this.kind = `fallback(${backends.map((backend) => backend.kind).join(",")})`;
  }

  async executeShellProcess(request: SeneraProcessShellExecutionRequest) {
    return this.executeWithFallback(request, (backend) => {
      const invocation = backend.resolveShellInvocation?.(request.shellCommand)
        ?? resolveSeneraShellInvocation(request.shellCommand);
      return backend.executeProcess({
        ...request,
        command: invocation.command,
        args: invocation.args,
      });
    });
  }

  async executeProcess(request: SeneraProcessExecutionRequest) {
    return this.executeWithFallback(request, (backend) => backend.executeProcess(request));
  }

  private async executeWithFallback<TRequest extends { profile?: SeneraProcessExecutionRequest["profile"] }>(
    request: TRequest,
    execute: (backend: SeneraProcessExecutionBackend) => Promise<Awaited<ReturnType<SeneraProcessExecutionBackend["executeProcess"]>>>,
  ) {
    let unavailableError: SeneraExecutionError | undefined;
    for (const backend of this.backends) {
      try {
        return await execute(backend);
      } catch (error) {
        if (!isSandboxUnavailable(error)) throw error;
        unavailableError = error;
        if (request.profile?.localFallback === "deny") {
          throw error;
        }
      }
    }

    throw unavailableError ?? new SeneraExecutionError(
      SeneraExecutionErrorCodes.SandboxUnavailable,
      "没有可用的执行后端。",
    );
  }
}

function isSandboxUnavailable(error: unknown): error is SeneraExecutionError {
  return error instanceof SeneraExecutionError
    && error.code === SeneraExecutionErrorCodes.SandboxUnavailable;
}
