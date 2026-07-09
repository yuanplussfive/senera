import type { ExecutionEnv } from "@earendil-works/pi-agent-core";
import type { AgentToolProcessSpawner } from "../ToolRuntime/AgentToolProcessTypes.js";
import type { SeneraProcessExecutionProfile } from "./SeneraExecutionProfile.js";
import type {
  SeneraPersistentProcessChild,
  SeneraPersistentProcessSpawnOptions,
} from "./SeneraPersistentProcessTypes.js";

export const SeneraExecutionErrorCodes = {
  Aborted: "aborted",
  InvalidWorkspacePath: "invalid_workspace_path",
  Timeout: "timeout",
  StdoutLimitExceeded: "stdout_limit_exceeded",
  StderrLimitExceeded: "stderr_limit_exceeded",
  SandboxUnavailable: "sandbox_unavailable",
  SpawnFailed: "spawn_failed",
  Unknown: "unknown",
} as const;

export type SeneraExecutionErrorCode =
  typeof SeneraExecutionErrorCodes[keyof typeof SeneraExecutionErrorCodes];

export class SeneraExecutionError extends Error {
  constructor(
    readonly code: SeneraExecutionErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = "SeneraExecutionError";
  }
}

export interface SeneraExecutionLimits {
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}

export interface SeneraShellExecutionRequest {
  command: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  limits: SeneraExecutionLimits;
  signal?: AbortSignal;
  stdin?: string;
  profile?: SeneraProcessExecutionProfile;
}

export interface SeneraShellExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface SeneraExecutionEnv extends ExecutionEnv {
  readonly workspaceRoot: string;
  executeShell(request: SeneraShellExecutionRequest): Promise<SeneraShellExecutionResult>;
  spawnProcess: AgentToolProcessSpawner;
  spawnPersistentProcess(
    command: string,
    args: readonly string[],
    options: SeneraPersistentProcessSpawnOptions,
  ): SeneraPersistentProcessChild;
}
