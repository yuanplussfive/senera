import type { ExecutionEnv } from "@earendil-works/pi-agent-core";
import type { SeneraProcessExecutionProfile } from "./SeneraExecutionProfile.js";
import type { AgentResourceAccessIntent } from "./SeneraResourceAccess.js";
import type { FileError, Result } from "@earendil-works/pi-agent-core";
import type {
  SeneraPersistentProcessChild,
  SeneraPersistentProcessSpawnOptions,
} from "./SeneraPersistentProcessTypes.js";
import type { SeneraTerminalChild, SeneraTerminalSpawnOptions } from "./SeneraTerminalTypes.js";
import type { SeneraShellDialect } from "./SeneraShellCommand.js";
import type { SeneraOutputSpool, SeneraOutputSpoolDescriptor } from "./SeneraOutputSpool.js";

export const SeneraExecutionErrorCodes = {
  Aborted: "aborted",
  InvalidWorkspacePath: "invalid_workspace_path",
  Timeout: "timeout",
  StdoutLimitExceeded: "stdout_limit_exceeded",
  StderrLimitExceeded: "stderr_limit_exceeded",
  SandboxUnavailable: "sandbox_unavailable",
  SpawnFailed: "spawn_failed",
  CleanupFailed: "cleanup_failed",
  Unknown: "unknown",
} as const;

export type SeneraExecutionErrorCode = (typeof SeneraExecutionErrorCodes)[keyof typeof SeneraExecutionErrorCodes];

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

export interface SeneraProcessOutputChunk {
  stream: "stdout" | "stderr";
  data: Uint8Array;
  totalBytes: number;
}

export interface SeneraShellExecutionRequest {
  command: string;
  dialect: SeneraShellDialect;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  limits: SeneraExecutionLimits;
  signal?: AbortSignal;
  stdin?: string;
  onOutput?: (chunk: SeneraProcessOutputChunk) => void;
  outputOverflow?: "terminate" | "truncate";
  outputSpool?: SeneraOutputSpool;
  profile?: SeneraProcessExecutionProfile;
}

export interface SeneraShellExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdoutBytes?: number;
  stderrBytes?: number;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  outputCapture?: SeneraOutputSpoolDescriptor;
}

export interface SeneraExecutionEnv extends ExecutionEnv {
  readonly workspaceRoot: string;
  resolveResourcePath(value: string, intent: AgentResourceAccessIntent): Promise<Result<string, FileError>>;
  executeShell(request: SeneraShellExecutionRequest): Promise<SeneraShellExecutionResult>;
  spawnPersistentProcess(
    command: string,
    args: readonly string[],
    options: SeneraPersistentProcessSpawnOptions,
  ): Promise<SeneraPersistentProcessChild>;
  spawnTerminal(
    command: string,
    args: readonly string[],
    options: SeneraTerminalSpawnOptions,
  ): Promise<SeneraTerminalChild>;
}
