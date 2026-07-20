import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  rmdir,
  type FileHandle,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ExecutionError, FileError, type FileInfo } from "@earendil-works/pi-agent-core";
import type { Result } from "@earendil-works/pi-agent-core";
import type {
  SeneraExecutionErrorCode,
  SeneraExecutionEnv,
  SeneraShellExecutionRequest,
  SeneraShellExecutionResult,
} from "./SeneraExecutionTypes.js";
import { SeneraExecutionError, SeneraExecutionErrorCodes } from "./SeneraExecutionTypes.js";
import { resolveSeneraShellInvocation, resolveSeneraShellPlatform } from "./SeneraShellPlatform.js";
import { SeneraNodeProcessBackend } from "./SeneraNodeProcessBackend.js";
import type { SeneraProcessExecutionBackend } from "./SeneraProcessExecutionBackend.js";
import { isSeneraShellDialectCompatible } from "./SeneraShellCommand.js";
import { createSeneraLocalPersistentProcessSpawner } from "./SeneraPersistentProcessSpawner.js";
import { SeneraWorkspaceBoundary, SeneraWorkspaceBoundaryError } from "./SeneraWorkspaceBoundary.js";
import {
  AgentResourceAccessIntents,
  type AgentResourceAccessIntent,
  type SeneraResourceAccessAuthorizer,
} from "./SeneraResourceAccess.js";
import type {
  SeneraPersistentProcessChild,
  SeneraPersistentProcessSpawner,
  SeneraPersistentProcessSpawnOptions,
} from "./SeneraPersistentProcessTypes.js";
import { createSeneraLocalTerminalSpawner } from "./SeneraTerminalSpawner.js";
import type { SeneraTerminalChild, SeneraTerminalSpawner, SeneraTerminalSpawnOptions } from "./SeneraTerminalTypes.js";

export interface SeneraLocalExecutionEnvOptions {
  workspaceRoot: string;
  processBackend?: SeneraProcessExecutionBackend;
  persistentProcessSpawner?: SeneraPersistentProcessSpawner;
  terminalSpawner?: SeneraTerminalSpawner;
  resourceAccessPolicy?: SeneraResourceAccessAuthorizer;
}

export class SeneraLocalExecutionEnv implements SeneraExecutionEnv {
  readonly workspaceRoot: string;
  readonly cwd: string;
  private readonly ownedTempRoots = new Map<string, SeneraWorkspaceBoundary>();
  private readonly workspaceBoundary: SeneraWorkspaceBoundary;
  private readonly processBackend: SeneraProcessExecutionBackend;
  private readonly persistentProcessSpawner: SeneraPersistentProcessSpawner;
  private readonly terminalSpawner: SeneraTerminalSpawner;

  constructor(options: SeneraLocalExecutionEnvOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.cwd = this.workspaceRoot;
    this.workspaceBoundary = new SeneraWorkspaceBoundary({
      workspaceRoot: this.workspaceRoot,
      policy: options.resourceAccessPolicy,
    });
    this.processBackend = options.processBackend ?? new SeneraNodeProcessBackend();
    this.persistentProcessSpawner = options.persistentProcessSpawner ?? createSeneraLocalPersistentProcessSpawner();
    this.terminalSpawner = options.terminalSpawner ?? createSeneraLocalTerminalSpawner();
  }

  async executeShell(request: SeneraShellExecutionRequest): Promise<SeneraShellExecutionResult> {
    const cwd = await this.resolveWorkspaceCwd(request.cwd);
    if (this.processBackend.executeShellProcess) {
      return this.processBackend.executeShellProcess({
        shellCommand: request.command,
        shellDialect: request.dialect,
        cwd,
        env: request.env,
        stdin: request.stdin,
        timeoutMs: request.timeoutMs ?? request.limits.timeoutMs,
        limits: request.limits,
        signal: request.signal,
        onOutput: request.onOutput,
        outputOverflow: request.outputOverflow,
        outputSpool: request.outputSpool,
        profile: request.profile,
      });
    }

    const backendDialect = this.processBackend.shellDialect;
    if (!backendDialect || !isSeneraShellDialectCompatible(request.dialect, backendDialect)) {
      throw new SeneraExecutionError(
        SeneraExecutionErrorCodes.SpawnFailed,
        `Shell dialect ${request.dialect} is not supported by backend ${this.processBackend.kind}.`,
        {
          reason: "shell_dialect_unsupported",
          requestedDialect: request.dialect,
          availableDialect: backendDialect,
          backend: this.processBackend.kind,
        },
      );
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
      onOutput: request.onOutput,
      outputOverflow: request.outputOverflow,
      outputSpool: request.outputSpool,
      profile: request.profile,
    });
  }

  spawnPersistentProcess = async (
    command: string,
    args: readonly string[],
    options: SeneraPersistentProcessSpawnOptions,
  ): Promise<SeneraPersistentProcessChild> => {
    const cwd = await this.resolveWorkspaceCwd(options.cwd);
    return this.persistentProcessSpawner(command, args, {
      ...options,
      cwd,
    });
  };

  spawnTerminal = async (
    command: string,
    args: readonly string[],
    options: SeneraTerminalSpawnOptions,
  ): Promise<SeneraTerminalChild> => {
    const cwd = await this.resolveWorkspaceCwd(options.cwd);
    return this.terminalSpawner(command, args, {
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
        dialect: resolveSeneraShellPlatform().family,
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
    return this.resolveFilePath(value, AgentResourceAccessIntents.Inspect);
  }

  async resolveResourcePath(value: string, intent: AgentResourceAccessIntent): Promise<Result<string, FileError>> {
    return this.resolveFilePath(value, intent);
  }

  async joinPath(parts: string[]): Promise<Result<string, FileError>> {
    return ok(path.join(...parts));
  }

  async readTextFile(value: string, abortSignal?: AbortSignal): Promise<Result<string, FileError>> {
    const opened = await this.openFileTarget(value, AgentResourceAccessIntents.Read);
    if (!opened.ok) return opened;
    const resolved = opened.value.path;
    if (abortSignal?.aborted) {
      await opened.value.handle.close().catch(() => undefined);
      return err(new FileError("aborted", "aborted", resolved));
    }
    try {
      return ok(await opened.value.handle.readFile({ encoding: "utf8", signal: abortSignal }));
    } catch (error) {
      return err(toFileError(error, resolved));
    } finally {
      await opened.value.handle.close().catch(() => undefined);
    }
  }

  async readTextLines(
    value: string,
    options?: { maxLines?: number; abortSignal?: AbortSignal },
  ): Promise<Result<string[], FileError>> {
    const opened = await this.openFileTarget(value, AgentResourceAccessIntents.Read);
    if (!opened.ok) return opened;
    const resolved = opened.value.path;
    if (options?.abortSignal?.aborted) {
      await opened.value.handle.close().catch(() => undefined);
      return err(new FileError("aborted", "aborted", resolved));
    }
    const maxLines = options?.maxLines;
    if (maxLines !== undefined && maxLines <= 0) {
      await opened.value.handle.close().catch(() => undefined);
      return ok([]);
    }

    let reader: ReturnType<FileHandle["readLines"]> | undefined;
    try {
      reader = opened.value.handle.readLines({
        encoding: "utf8",
        signal: options?.abortSignal,
      });
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
      await opened.value.handle.close().catch(() => undefined);
    }
  }

  async readBinaryFile(value: string, abortSignal?: AbortSignal): Promise<Result<Uint8Array, FileError>> {
    const opened = await this.openFileTarget(value, AgentResourceAccessIntents.Read);
    if (!opened.ok) return opened;
    const resolved = opened.value.path;
    if (abortSignal?.aborted) {
      await opened.value.handle.close().catch(() => undefined);
      return err(new FileError("aborted", "aborted", resolved));
    }
    try {
      return ok(await opened.value.handle.readFile({ signal: abortSignal }));
    } catch (error) {
      return err(toFileError(error, resolved));
    } finally {
      await opened.value.handle.close().catch(() => undefined);
    }
  }

  async writeFile(
    value: string,
    content: string | Uint8Array,
    abortSignal?: AbortSignal,
  ): Promise<Result<void, FileError>> {
    const pathResult = await this.resolveFilePath(value, AgentResourceAccessIntents.Replace);
    if (!pathResult.ok) return pathResult;
    const resolved = pathResult.value;
    if (abortSignal?.aborted) return err(new FileError("aborted", "aborted", resolved));
    try {
      await this.atomicWrite(value, resolved, content, abortSignal);
      return ok(undefined);
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async appendFile(
    value: string,
    content: string | Uint8Array,
    abortSignal?: AbortSignal,
  ): Promise<Result<void, FileError>> {
    const pathResult = await this.resolveFilePath(value, AgentResourceAccessIntents.Replace);
    if (!pathResult.ok) return pathResult;
    const resolved = pathResult.value;
    try {
      await mkdir(path.dirname(resolved), { recursive: true });
      const revalidated = await this.resolveFilePath(value, AgentResourceAccessIntents.Replace);
      if (!revalidated.ok) return revalidated;
      if (abortSignal?.aborted) return err(new FileError("aborted", "aborted", revalidated.value));
      await appendFile(revalidated.value, content);
      return ok(undefined);
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async fileInfo(value: string): Promise<Result<FileInfo, FileError>> {
    const pathResult = await this.resolveFileTarget(value, AgentResourceAccessIntents.Inspect);
    if (!pathResult.ok) return pathResult;
    const resolved = pathResult.value.addressedPath;
    try {
      return fileInfoFromStats(resolved, await lstat(resolved));
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async listDir(value: string, abortSignal?: AbortSignal): Promise<Result<FileInfo[], FileError>> {
    const pathResult = await this.resolveFilePath(value, AgentResourceAccessIntents.Read);
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
    return this.resolveFilePath(value, AgentResourceAccessIntents.Read);
  }

  async exists(value: string): Promise<Result<boolean, FileError>> {
    const pathResult = await this.resolveFilePath(value, AgentResourceAccessIntents.Inspect);
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
    const pathResult = await this.resolveFilePath(value, AgentResourceAccessIntents.Create);
    if (!pathResult.ok) return pathResult;
    const resolved = pathResult.value;
    if (options?.abortSignal?.aborted) return err(new FileError("aborted", "aborted", resolved));
    try {
      await mkdir(resolved, { recursive: options?.recursive ?? true });
      await this.assertStableWorkspaceTarget(value, AgentResourceAccessIntents.Create, resolved);
      return ok(undefined);
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async remove(
    value: string,
    options?: { recursive?: boolean; force?: boolean; abortSignal?: AbortSignal },
  ): Promise<Result<void, FileError>> {
    const pathResult = await this.resolveFilePath(value, AgentResourceAccessIntents.Remove);
    if (!pathResult.ok) return pathResult;
    const resolved = pathResult.value;
    if (options?.abortSignal?.aborted) return err(new FileError("aborted", "aborted", resolved));
    try {
      const recursive = options?.recursive ?? false;
      const stats = await lstat(resolved);
      if (stats.isDirectory() && !recursive) {
        await rmdir(resolved);
      } else {
        await rm(resolved, { recursive, force: options?.force ?? false });
      }
      const verification = await this.workspaceBoundary.inspect(value, AgentResourceAccessIntents.Remove);
      if (verification.absolutePath && verification.absolutePath !== resolved) {
        throw new SeneraWorkspaceBoundaryError("unresolved_path", "目标路径在删除期间发生变化。", verification.facts);
      }
      return ok(undefined);
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async createTempDir(prefix = "tmp-", abortSignal?: AbortSignal): Promise<Result<string, FileError>> {
    if (abortSignal?.aborted) return err(new FileError("aborted", "aborted"));
    try {
      const directory = await mkdtemp(path.join(tmpdir(), prefix));
      const root = path.resolve(directory);
      this.ownedTempRoots.set(
        root,
        new SeneraWorkspaceBoundary({
          workspaceRoot: root,
          scope: "temporary",
        }),
      );
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
    await Promise.all(roots.map(([root]) => rm(root, { recursive: true, force: true })));
  }

  private async resolveWorkspaceCwd(value: string | undefined): Promise<string> {
    try {
      return (await this.workspaceBoundary.resolve(value, AgentResourceAccessIntents.Execute)).absolutePath;
    } catch (error) {
      throw new SeneraExecutionError(
        SeneraExecutionErrorCodes.InvalidWorkspacePath,
        error instanceof Error ? error.message : String(error),
        { cwd: value ?? ".", workspaceRoot: this.workspaceRoot },
        error instanceof Error ? error : undefined,
      );
    }
  }

  private async resolveFilePath(value: string, intent: AgentResourceAccessIntent): Promise<Result<string, FileError>> {
    const target = await this.resolveFileTarget(value, intent);
    return target.ok ? ok(target.value.absolutePath) : target;
  }

  private async resolveFileTarget(
    value: string,
    intent: AgentResourceAccessIntent,
  ): Promise<Result<Awaited<ReturnType<SeneraWorkspaceBoundary["resolve"]>>, FileError>> {
    const addressed = path.isAbsolute(value) ? path.resolve(value) : path.resolve(this.cwd, value);
    const boundary = this.boundaryForAddressedPath(addressed);
    if (!boundary) {
      return err(new FileError("permission_denied", `路径超出执行工作区：${value}`, addressed));
    }
    try {
      return ok(await boundary.resolve(addressed, intent));
    } catch (error) {
      return err(toBoundaryFileError(error, addressed));
    }
  }

  private async openFileTarget(
    value: string,
    intent: AgentResourceAccessIntent,
  ): Promise<Result<{ path: string; handle: FileHandle }, FileError>> {
    const addressed = path.isAbsolute(value) ? path.resolve(value) : path.resolve(this.cwd, value);
    const boundary = this.boundaryForAddressedPath(addressed);
    if (!boundary) {
      return err(new FileError("permission_denied", `路径超出执行工作区：${value}`, addressed));
    }
    try {
      const opened = await boundary.openFile(addressed, intent);
      return ok({ path: opened.target.absolutePath, handle: opened.handle });
    } catch (error) {
      return err(toBoundaryFileError(error, addressed));
    }
  }

  private boundaryForAddressedPath(value: string): SeneraWorkspaceBoundary | undefined {
    if (isPathInside(this.workspaceRoot, value)) return this.workspaceBoundary;
    return [...this.ownedTempRoots].find(([root]) => isPathInside(root, value))?.[1];
  }

  private async atomicWrite(
    value: string,
    resolved: string,
    content: string | Uint8Array,
    signal?: AbortSignal,
  ): Promise<void> {
    await mkdir(path.dirname(resolved), { recursive: true });
    if (signal?.aborted) throw new FileError("aborted", "aborted", resolved);
    const revalidated = await this.resolveFilePath(value, AgentResourceAccessIntents.Replace);
    if (!revalidated.ok) throw revalidated.error;
    const target = revalidated.value;
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, content, { flag: "wx", signal });
      await rename(temporary, target);
      await this.assertStableWorkspaceTarget(value, AgentResourceAccessIntents.Replace, target);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  private async assertStableWorkspaceTarget(
    value: string,
    intent: AgentResourceAccessIntent,
    expected: string,
  ): Promise<void> {
    const verification = await this.resolveFilePath(value, intent);
    if (!verification.ok || verification.value !== expected) {
      throw new SeneraWorkspaceBoundaryError(
        "unresolved_path",
        `工作区目标在操作期间发生变化：${value}`,
        verification.ok ? undefined : undefined,
      );
    }
  }
}

function ok<TValue>(value: TValue): Result<TValue, never> {
  return { ok: true, value };
}

function err<TError>(error: TError): Result<never, TError> {
  return { ok: false, error };
}

function isPathInside(root: string, value: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(value));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function toBoundaryFileError(error: unknown, filePath: string): FileError {
  if (error instanceof SeneraWorkspaceBoundaryError) {
    return new FileError("permission_denied", error.message, filePath, error);
  }
  return toFileError(error, filePath);
}

const PiExecutionCodeBySeneraCode = {
  [SeneraExecutionErrorCodes.Aborted]: "aborted",
  [SeneraExecutionErrorCodes.InvalidWorkspacePath]: "unknown",
  [SeneraExecutionErrorCodes.Timeout]: "timeout",
  [SeneraExecutionErrorCodes.StdoutLimitExceeded]: "unknown",
  [SeneraExecutionErrorCodes.StderrLimitExceeded]: "unknown",
  [SeneraExecutionErrorCodes.SandboxUnavailable]: "unknown",
  [SeneraExecutionErrorCodes.SpawnFailed]: "spawn_error",
  [SeneraExecutionErrorCodes.CleanupFailed]: "unknown",
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
