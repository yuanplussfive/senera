import type {
  SeneraShellExecutionRequest,
  SeneraShellExecutionResult,
} from "./SeneraExecutionTypes.js";
import type { SeneraProcessExecutionProfile } from "./SeneraExecutionProfile.js";
import type { SeneraShellInvocation } from "./SeneraShellPlatform.js";

export interface SeneraProcessExecutionRequest {
  command: string;
  args: readonly string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs: number;
  limits: SeneraShellExecutionRequest["limits"];
  signal?: AbortSignal;
  profile?: SeneraProcessExecutionProfile;
}

export interface SeneraProcessShellExecutionRequest extends Omit<SeneraProcessExecutionRequest, "command" | "args"> {
  shellCommand: string;
}

export interface SeneraProcessExecutionBackend {
  readonly kind: string;
  resolveShellInvocation?(command: string): SeneraShellInvocation;
  executeShellProcess?(request: SeneraProcessShellExecutionRequest): Promise<SeneraShellExecutionResult>;
  executeProcess(request: SeneraProcessExecutionRequest): Promise<SeneraShellExecutionResult>;
}
