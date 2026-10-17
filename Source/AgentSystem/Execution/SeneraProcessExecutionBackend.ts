import type { SeneraShellExecutionRequest, SeneraShellExecutionResult } from "./SeneraExecutionTypes.js";
import type { SeneraProcessExecutionProfile } from "./SeneraExecutionProfile.js";
import type { SeneraShellInvocation } from "./SeneraShellPlatform.js";
import type { SeneraShellDialect } from "./SeneraShellCommand.js";

export interface SeneraProcessExecutionRequest {
  command: string;
  args: readonly string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs: number;
  limits: SeneraShellExecutionRequest["limits"];
  signal?: AbortSignal;
  onOutput?: SeneraShellExecutionRequest["onOutput"];
  outputOverflow?: SeneraShellExecutionRequest["outputOverflow"];
  outputSpool?: SeneraShellExecutionRequest["outputSpool"];
  profile?: SeneraProcessExecutionProfile;
}

export interface SeneraProcessShellExecutionRequest extends Omit<SeneraProcessExecutionRequest, "command" | "args"> {
  shellCommand: string;
  shellDialect: SeneraShellDialect;
}

export interface SeneraProcessExecutionBackend {
  readonly kind: string;
  readonly shellDialect?: SeneraShellDialect;
  resolveShellInvocation?(command: string): SeneraShellInvocation;
  executeShellProcess?(request: SeneraProcessShellExecutionRequest): Promise<SeneraShellExecutionResult>;
  executeProcess(request: SeneraProcessExecutionRequest): Promise<SeneraShellExecutionResult>;
}
