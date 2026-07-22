import type {
  SeneraProcessExecutionBackend,
  SeneraProcessExecutionRequest,
  SeneraProcessShellExecutionRequest,
} from "./SeneraProcessExecutionBackend.js";
import { SeneraExecutionError, SeneraExecutionErrorCodes } from "./SeneraExecutionTypes.js";
import { resolveSeneraShellInvocation } from "./SeneraShellPlatform.js";
import { isSeneraShellDialectCompatible } from "./SeneraShellCommand.js";

export interface SeneraRoutingProcessBackendOptions {
  readonly local: SeneraProcessExecutionBackend;
  readonly sandbox: SeneraProcessExecutionBackend;
}

export class SeneraRoutingProcessBackend implements SeneraProcessExecutionBackend {
  readonly kind: string;

  constructor(private readonly options: SeneraRoutingProcessBackendOptions) {
    this.kind = `route(local=${options.local.kind},sandbox=${options.sandbox.kind})`;
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
    return profile.backend === "local"
      ? execute(this.options.local, "local")
      : execute(this.options.sandbox, "sandbox");
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
