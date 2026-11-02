import type {
  SeneraOperationContext as Context,
  SeneraFileError as FileError,
  SeneraFileInfo as FileInfo,
  SeneraOperationResult as Result,
} from "./SeneraFileSystemTypes.js";
import type { TruncationResult } from "@earendil-works/pi-coding-agent";
import type { SeneraProcessExecutionProfile } from "./SeneraExecutionProfile.js";
import type {
  AgentResourceAccessAuthority,
  AgentResourceAccessGrant,
  AgentResourceAccessIntent,
  AgentResourceAccessPlan,
} from "./SeneraResourceAccess.js";
import type {
  SeneraPersistentProcessChild,
  SeneraPersistentProcessSpawnOptions,
} from "./SeneraPersistentProcessTypes.js";
import type { SeneraTerminalChild, SeneraTerminalSpawnOptions } from "./SeneraTerminalTypes.js";
import type { SeneraShellDialect } from "./SeneraShellCommand.js";
import type { SeneraOutputSpool, SeneraOutputSpoolDescriptor } from "./SeneraOutputSpool.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import type { SeneraExecutionRuntimeCapabilities } from "./SeneraExecutionRuntimeCapabilities.js";

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

export class SeneraExecutionError extends AgentBaseError {
  constructor(
    readonly code: SeneraExecutionErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
    cause?: Error,
    readonly diagnostic?: Readonly<Record<string, unknown>>,
  ) {
    super(message, cause ? { cause } : undefined);
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

export interface SeneraArgvExecutionRequest {
  command: string;
  args: readonly string[];
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

export interface SeneraTextLineReader {
  readLine(context: Context): Promise<Result<{ text: string; terminated: boolean } | undefined, FileError>>;
  close(context: Context): Promise<void>;
}

export type SeneraExecutionContext = Context | AbortSignal | undefined;

export interface SeneraShellOutputMetadata {
  readonly truncation: Omit<TruncationResult, "content">;
  readonly spillPath?: string;
}

export interface SeneraShellExecOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Timeout in seconds. */
  readonly timeout?: number;
  readonly capture?: { readonly limits: { readonly maxBytes?: number; readonly maxLines?: number } };
  readonly abortSignal?: AbortSignal;
  readonly onStdout?: (chunk: string) => void;
  readonly onStderr?: (chunk: string) => void;
  readonly onUpdate?: (
    update: { readonly kind: "replace"; readonly output: SeneraShellOutputMetadata & { readonly text: string } },
    context: Context,
  ) => void;
}

export interface SeneraShellExecResult extends SeneraShellOutputMetadata {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Host-owned resource and execution contract; Pi tools use explicit operation adapters. */
export interface SeneraExecutionEnv {
  readonly cwd: string;
  readonly workspaceRoot: string;
  readonly capabilities: SeneraExecutionRuntimeCapabilities;
  absolutePath(value: string, context?: SeneraExecutionContext): Promise<Result<string, FileError>>;
  joinPath(parts: string[], context?: SeneraExecutionContext): Promise<Result<string, FileError>>;
  readTextFile(value: string, context?: SeneraExecutionContext): Promise<Result<string, FileError>>;
  openTextLineReader(value: string, context?: Context): Promise<Result<SeneraTextLineReader, FileError>>;
  readTextLines(
    value: string,
    options?: { maxLines?: number; abortSignal?: AbortSignal },
    context?: Context,
  ): Promise<Result<string[], FileError>>;
  readBinaryFile(value: string, context?: SeneraExecutionContext): Promise<Result<Uint8Array, FileError>>;
  writeFile(
    value: string,
    content: string | Uint8Array,
    context?: SeneraExecutionContext,
  ): Promise<Result<void, FileError>>;
  appendFile(
    value: string,
    content: string | Uint8Array,
    context?: SeneraExecutionContext,
  ): Promise<Result<void, FileError>>;
  renameFile(
    sourcePath: string,
    destinationPath: string,
    context?: SeneraExecutionContext,
  ): Promise<Result<void, FileError>>;
  fileInfo(value: string, context?: Context): Promise<Result<FileInfo, FileError>>;
  /** Enumerate names without reading metadata or following individual children. */
  readDirectoryNames(value: string, context?: SeneraExecutionContext): Promise<Result<string[], FileError>>;
  listDir(value: string, context?: SeneraExecutionContext): Promise<Result<FileInfo[], FileError>>;
  canonicalPath(value: string, context?: SeneraExecutionContext): Promise<Result<string, FileError>>;
  exists(value: string, context?: Context): Promise<Result<boolean, FileError>>;
  createDir(
    value: string,
    options?: { recursive?: boolean; abortSignal?: AbortSignal },
    context?: Context,
  ): Promise<Result<void, FileError>>;
  remove(
    value: string,
    options?: { recursive?: boolean; force?: boolean; abortSignal?: AbortSignal },
    context?: Context,
  ): Promise<Result<void, FileError>>;
  createTempDir(prefix?: string, context?: SeneraExecutionContext): Promise<Result<string, FileError>>;
  createTempFile(
    options?: { prefix?: string; suffix?: string; abortSignal?: AbortSignal },
    context?: Context,
  ): Promise<Result<string, FileError>>;
  cleanup(context?: Context): Promise<void>;
  exec(
    command: string,
    options?: SeneraShellExecOptions,
    context?: Context,
  ): Promise<Result<SeneraShellExecResult, SeneraExecutionError>>;
  resolveResourcePath(value: string, intent: AgentResourceAccessIntent): Promise<Result<string, FileError>>;
  inspectResourcePath(
    value: string,
    intent: AgentResourceAccessIntent,
  ): Promise<AgentResourceAccessPlan["requests"][number]>;
  withResourceAccessAuthority(authority: AgentResourceAccessAuthority): SeneraExecutionEnv;
  withResourceAccessGrant(grant: AgentResourceAccessGrant): SeneraExecutionEnv;
  executeShell(request: SeneraShellExecutionRequest): Promise<SeneraShellExecutionResult>;
  executeProcess(request: SeneraArgvExecutionRequest): Promise<SeneraShellExecutionResult>;
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
