import { spawn } from "cross-spawn";
import { randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  access,
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { ExecutionError, FileError, type FileInfo } from "@earendil-works/pi-agent-core";
import type { Result } from "@earendil-works/pi-agent-core";
import type {
  SeneraExecutionErrorCode,
  SeneraExecutionEnv,
  SeneraShellExecutionRequest,
  SeneraShellExecutionResult,
} from "./SeneraExecutionTypes.js";
import { SeneraExecutionError, SeneraExecutionErrorCodes } from "./SeneraExecutionTypes.js";
import { resolveSeneraShellInvocation } from "./SeneraShellPlatform.js";
import { resolveWorkspacePath } from "./SeneraWorkspacePath.js";
import { SeneraNodeProcessBackend } from "./SeneraNodeProcessBackend.js";
import type { SeneraProcessExecutionBackend } from "./SeneraProcessExecutionBackend.js";
import type {
  AgentToolProcessChild,
  AgentToolProcessSpawner,
  AgentToolProcessSpawnOptions,
} from "../ToolRuntime/AgentToolProcessTypes.js";
import { createSeneraLocalPersistentProcessSpawner } from "./SeneraPersistentProcessSpawner.js";
import type {
  SeneraPersistentProcessChild,
  SeneraPersistentProcessSpawner,
  SeneraPersistentProcessSpawnOptions,
} from "./SeneraPersistentProcessTypes.js";

export interface SeneraLocalExecutionEnvOptions {
  workspaceRoot: string;
  processBackend?: SeneraProcessExecutionBackend;
  processSpawner?: AgentToolProcessSpawner;
  persistentProcessSpawner?: SeneraPersistentProcessSpawner;
}

export class SeneraLocalExecutionEnv implements SeneraExecutionEnv {
  readonly workspaceRoot: string;
  readonly cwd: string;
  private readonly ownedTempRoots = new Set<string>();
  private readonly processBackend: SeneraProcessExecutionBackend;
  private readonly processSpawner: AgentToolProcessSpawner;
  private readonly persistentProcessSpawner: SeneraPersistentProcessSpawner;

  constructor(options: SeneraLocalExecutionEnvOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.cwd = this.workspaceRoot;
    this.processBackend = options.processBackend ?? new SeneraNodeProcessBackend();
    this.processSpawner = options.processSpawner ?? defaultProcessSpawner;
    this.persistentProcessSpawner = options.persistentProcessSpawner ?? createSeneraLocalPersistentProcessSpawner();
  }

  async executeShell(request: SeneraShellExecutionRequest): Promise<SeneraShellExecutionResult> {
    const cwd = this.resolveWorkspaceCwd(request.cwd);
    if (this.processBackend.executeShellProcess) {
      return this.processBackend.executeShellProcess({
        shellCommand: request.command,
        cwd,
        env: request.env,
        stdin: request.stdin,
        timeoutMs: request.timeoutMs ?? request.limits.timeoutMs,
        limits: request.limits,
        signal: request.signal,
        profile: request.profile,
      });
    }

    const invocation =
      this.processBackend.resolveShellInvocation?.(request.command) ?? resolveSeneraShellInvocation(request.command);
    return this.processBackend.executeProcess({
      command: invocation.command,
      args: invocation.args,
      cwd,
      env: request.env,
      stdin: request.stdin,
      timeoutMs: request.timeoutMs ?? request.limits.timeoutMs,
      limits: request.limits,
      signal: request.signal,
      profile: request.profile,
    });
  }

  spawnProcess = (command: string, args: string[], options: AgentToolProcessSpawnOptions): AgentToolProcessChild => {
    const cwd = this.resolveWorkspaceCwd(options.cwd);
    return this.processSpawner(command, args, {
      ...options,
      cwd,
    });
  };

  spawnPersistentProcess = (
    command: string,
    args: readonly string[],
    options: SeneraPersistentProcessSpawnOptions,
  ): Promise<SeneraPersistentProcessChild> => {
    const cwd = this.resolveWorkspaceCwd(options.cwd);
    return this.persistentProcessSpawner(command, args, {
      ...options,
      cwd,
    });
  };

  async exec(
    command: string,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      timeout?: number;
      abortSignal?: AbortSignal;
      onStdout?: (chunk: string) => void;
      onStderr?: (chunk: string) => void;
    },
  ): Promise<Result<{ stdout: string; stderr: string; exitCode: number }, ExecutionError>> {
    try {
      const result = await this.executeShell({
        command,
        cwd: options?.cwd,
        env: options?.env,
        timeoutMs: options?.timeout === undefined ? undefined : options.timeout * 1000,
        limits: {
          timeoutMs: options?.timeout === undefined ? 0 : options.timeout * 1000,
          maxStdoutBytes: Number.MAX_SAFE_INTEGER,
          maxStderrBytes: Number.MAX_SAFE_INTEGER,
        },
        signal: options?.abortSignal,
      });
      options?.onStdout?.(result.stdout);
      options?.onStderr?.(result.stderr);
      return ok({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode ?? 0,
      });
    } catch (error) {
      return err(toPiExecutionError(error));
    }
  }

  async absolutePath(value: string): Promise<Result<string, FileError>> {
    return this.safeFilePath(value, (resolved) => ok(resolved));
  }

  async joinPath(parts: string[]): Promise<Result<string, FileError>> {
    return ok(path.join(...parts));
  }

  async readTextFile(value: string, abortSignal?: AbortSignal): Promise<Result<string, FileError>> {
    const pathResult = this.safeFilePath(value);
    if (!pathResult.ok) return pathResult;
    const resolved = pathResult.value;
    if (abortSignal?.aborted) return err(new FileError("aborted", "aborted", resolved));
    try {
      return ok(await readFile(resolved, { encoding: "utf8", signal: abortSignal }));
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async readTextLines(
    value: string,
    options?: { maxLines?: number; abortSignal?: AbortSignal },
  ): Promise<Result<string[], FileError>> {
    const pathResult = this.safeFilePath(value);
    if (!pathResult.ok) return pathResult;
    const resolved = pathResult.value;
    if (options?.abortSignal?.aborted) return err(new FileError("aborted", "aborted", resolved));
    const maxLines = options?.maxLines;
    if (maxLines !== undefined && maxLines <= 0) return ok([]);

    let stream: ReturnType<typeof createReadStream> | undefined;
    let reader: ReturnType<typeof createInterface> | undefined;
    try {
      stream = createReadStream(resolved, { encoding: "utf8", signal: options?.abortSignal });
      reader = createInterface({ input: stream, crlfDelay: Infinity });
      const lines: string[] = [];
      for await (const line of reader) {
        if (options?.abortSignal?.aborted) return err(new FileError("aborted", "aborted", resolved));
        lines.push(line);
        if (maxLines !== undefined && lines.length >= maxLines) break;
      }
      return ok(lines);
    } catch (error) {
      return err(toFileError(error, resolved));
    } finally {
      reader?.close();
      stream?.destroy();
    }
  }

  async readBinaryFile(value: string, abortSignal?: AbortSignal): Promise<Result<Uint8Array, FileError>> {
    const pathResult = this.safeFilePath(value);
    if (!pathResult.ok) return pathResult;
    const resolved = pathResult.value;
    if (abortSignal?.aborted) return err(new FileError("aborted", "aborted", resolved));
    try {
      return ok(await readFile(resolved, { signal: abortSignal }));
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async writeFile(
    value: string,
    content: string | Uint8Array,
    abortSignal?: AbortSignal,
  ): Promise<Result<void, FileError>> {
    const pathResult = this.safeFilePath(value);
    if (!pathResult.ok) return pathResult;
    const resolved = pathResult.value;
    if (abortSignal?.aborted) return err(new FileError("aborted", "aborted", resolved));
    try {
      await mkdir(path.dirname(resolved), { recursive: true });
      if (abortSignal?.aborted) return err(new FileError("aborted", "aborted", resolved));
      await writeFile(resolved, content, { signal: abortSignal });
      return ok(undefined);
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async appendFile(value: string, content: string | Uint8Array): Promise<Result<void, FileError>> {
    const pathResult = this.safeFilePath(value);
    if (!pathResult.ok) return pathResult;
    const resolved = pathResult.value;
    try {
      await mkdir(path.dirname(resolved), { recursive: true });
      await appendFile(resolved, content);
      return ok(undefined);
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async fileInfo(value: string): Promise<Result<FileInfo, FileError>> {
    const pathResult = this.safeFilePath(value);
    if (!pathResult.ok) return pathResult;
    const resolved = pathResult.value;
    try {
      return fileInfoFromStats(resolved, await lstat(resolved));
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async listDir(value: string, abortSignal?: AbortSignal): Promise<Result<FileInfo[], FileError>> {
    const pathResult = this.safeFilePath(value);
    if (!pathResult.ok) return pathResult;
    const resolved = pathResult.value;
    if (abortSignal?.aborted) return err(new FileError("aborted", "aborted", resolved));
    try {
      const entries = await readdir(resolved, { withFileTypes: true });
      const infos: FileInfo[] = [];
      for (const entry of entries) {
        const entryPath = path.resolve(resolved, entry.name);
        const info = fileInfoFromStats(entryPath, await lstat(entryPath));
        if (info.ok) infos.push(info.value);
      }
      return ok(infos);
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async canonicalPath(value: string): Promise<Result<string, FileError>> {
    const pathResult = this.safeFilePath(value);
    if (!pathResult.ok) return pathResult;
    const resolved = pathResult.value;
    try {
      const canonical = await realpath(resolved);
      return (await this.isAllowedCanonicalFilePath(canonical))
        ? ok(canonical)
        : err(new FileError("permission_denied", `路径超出执行工作区：${value}`, canonical));
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async exists(value: string): Promise<Result<boolean, FileError>> {
    const pathResult = this.safeFilePath(value);
    if (!pathResult.ok) return pathResult;
    const resolved = pathResult.value;
    try {
      await access(resolved, constants.F_OK);
      return ok(true);
    } catch (error) {
      const fileError = toFileError(error, resolved);
      return fileError.code === "not_found" ? ok(false) : err(fileError);
    }
  }

  async createDir(
    value: string,
    options?: { recursive?: boolean; abortSignal?: AbortSignal },
  ): Promise<Result<void, FileError>> {
    const pathResult = this.safeFilePath(value);
    if (!pathResult.ok) return pathResult;
    const resolved = pathResult.value;
    if (options?.abortSignal?.aborted) return err(new FileError("aborted", "aborted", resolved));
    try {
      await mkdir(resolved, { recursive: options?.recursive ?? true });
      return ok(undefined);
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async remove(
    value: string,
    options?: { recursive?: boolean; force?: boolean; abortSignal?: AbortSignal },
  ): Promise<Result<void, FileError>> {
    const pathResult = this.safeFilePath(value);
    if (!pathResult.ok) return pathResult;
    const resolved = pathResult.value;
    if (options?.abortSignal?.aborted) return err(new FileError("aborted", "aborted", resolved));
    try {
      await rm(resolved, { recursive: options?.recursive ?? false, force: options?.force ?? false });
      return ok(undefined);
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async createTempDir(prefix = "tmp-", abortSignal?: AbortSignal): Promise<Result<string, FileError>> {
    if (abortSignal?.aborted) return err(new FileError("aborted", "aborted"));
    try {
      const directory = await mkdtemp(path.join(tmpdir(), prefix));
      this.ownedTempRoots.add(path.resolve(directory));
      return ok(directory);
    } catch (error) {
      return err(toFileError(error));
    }
  }

  async createTempFile(options?: {
    prefix?: string;
    suffix?: string;
    abortSignal?: AbortSignal;
  }): Promise<Result<string, FileError>> {
    const dir = await this.createTempDir("tmp-", options?.abortSignal);
    if (!dir.ok) return dir;
    const filePath = path.join(dir.value, `${options?.prefix ?? ""}${randomUUID()}${options?.suffix ?? ""}`);
    try {
      await writeFile(filePath, "");
      return ok(filePath);
    } catch (error) {
      return err(toFileError(error, filePath));
    }
  }

  async cleanup(): Promise<void> {
    const roots = [...this.ownedTempRoots];
    this.ownedTempRoots.clear();
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  }

  private resolveWorkspaceCwd(value: string | undefined): string {
    const resolved = resolveWorkspacePath(this.workspaceRoot, value);
    if (!resolved.ok) {
      throw new SeneraExecutionError(SeneraExecutionErrorCodes.InvalidWorkspacePath, resolved.message, {
        cwd: value ?? ".",
        workspaceRoot: this.workspaceRoot,
      });
    }
    return resolved.absolutePath;
  }

  private safeFilePath(value: string): Result<string, FileError>;
  private safeFilePath<TValue>(
    value: string,
    mapper: (resolved: string) => Result<TValue, FileError>,
  ): Result<TValue, FileError>;
  private safeFilePath<TValue = string>(
    value: string,
    mapper?: (resolved: string) => Result<TValue, FileError>,
  ): Result<TValue | string, FileError> {
    const resolved = path.isAbsolute(value) ? path.resolve(value) : path.resolve(this.cwd, value);
    return this.isAllowedFilePath(resolved)
      ? (mapper?.(resolved) ?? ok(resolved))
      : err(new FileError("permission_denied", `路径超出执行工作区：${value}`, resolved));
  }

  private isAllowedFilePath(value: string): boolean {
    return (
      isPathInside(this.workspaceRoot, value) || [...this.ownedTempRoots].some((root) => isPathInside(root, value))
    );
  }

  private async isAllowedCanonicalFilePath(value: string): Promise<boolean> {
    for (const root of [this.workspaceRoot, ...this.ownedTempRoots]) {
      try {
        if (isPathInside(await realpath(root), value)) return true;
      } catch {
        // A removed temporary root cannot authorize a canonical path.
      }
    }
    return false;
  }
}

function ok<TValue>(value: TValue): Result<TValue, never> {
  return { ok: true, value };
}

function err<TError>(error: TError): Result<never, TError> {
  return { ok: false, error };
}

const defaultProcessSpawner: AgentToolProcessSpawner = (command, args, options) =>
  spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio,
    windowsHide: options.windowsHide,
  }) as AgentToolProcessChild;

function isPathInside(root: string, value: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(value));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

const PiExecutionCodeBySeneraCode = {
  [SeneraExecutionErrorCodes.Aborted]: "aborted",
  [SeneraExecutionErrorCodes.InvalidWorkspacePath]: "unknown",
  [SeneraExecutionErrorCodes.Timeout]: "timeout",
  [SeneraExecutionErrorCodes.StdoutLimitExceeded]: "unknown",
  [SeneraExecutionErrorCodes.StderrLimitExceeded]: "unknown",
  [SeneraExecutionErrorCodes.SandboxUnavailable]: "unknown",
  [SeneraExecutionErrorCodes.SpawnFailed]: "spawn_error",
  [SeneraExecutionErrorCodes.Unknown]: "unknown",
} satisfies Record<SeneraExecutionErrorCode, ConstructorParameters<typeof ExecutionError>[0]>;

function toPiExecutionError(error: unknown): ExecutionError {
  if (error instanceof ExecutionError) {
    return error;
  }
  if (error instanceof SeneraExecutionError) {
    return new ExecutionError(PiExecutionCodeBySeneraCode[error.code], error.message, error);
  }

  const cause = error instanceof Error ? error : new Error(String(error));
  return new ExecutionError("unknown", cause.message, cause);
}

function fileInfoFromStats(
  filePath: string,
  stats: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean; size: number; mtimeMs: number },
): Result<FileInfo, FileError> {
  const kind = stats.isFile()
    ? "file"
    : stats.isDirectory()
      ? "directory"
      : stats.isSymbolicLink()
        ? "symlink"
        : undefined;
  return kind
    ? ok({
        name: path.basename(filePath),
        path: filePath,
        kind,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      })
    : err(new FileError("invalid", "Unsupported file type", filePath));
}

function toFileError(error: unknown, filePath?: string): FileError {
  if (error instanceof FileError) return error;
  const cause = error instanceof Error ? error : new Error(String(error));
  const code =
    typeof (error as NodeJS.ErrnoException | undefined)?.code === "string"
      ? (error as NodeJS.ErrnoException).code
      : undefined;

  const mappings: Record<string, ConstructorParameters<typeof FileError>[0]> = {
    ABORT_ERR: "aborted",
    ENOENT: "not_found",
    EACCES: "permission_denied",
    EPERM: "permission_denied",
    ENOTDIR: "not_directory",
    EISDIR: "is_directory",
    EINVAL: "invalid",
  };
  return new FileError(code ? (mappings[code] ?? "unknown") : "unknown", cause.message, filePath, cause);
}
