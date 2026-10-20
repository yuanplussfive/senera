import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function nodeErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" ? code : undefined;
}

export function isMissingFileError(error: unknown): boolean {
  return nodeErrorCode(error) === "ENOENT";
}

export function isFileExistsError(error: unknown): boolean {
  return nodeErrorCode(error) === "EEXIST";
}

/** Entry names of an optional directory; empty when it has not been created yet. */
export function listDirectoryNamesSync(directory: string): string[] {
  try {
    return fs.readdirSync(directory);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
}

export async function runWithConcurrency<TValue, TResult>(
  values: readonly TValue[],
  concurrency: number,
  worker: (value: TValue) => Promise<TResult>,
): Promise<TResult[]> {
  if (values.length === 0) return [];
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Concurrency must be a positive safe integer.");
  }
  const results = new Array<TResult>(values.length);
  let nextIndex = 0;
  const runWorker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex++;
      if (index >= values.length) return;
      const value = values[index];
      if (value === undefined) return;
      results[index] = await worker(value);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => runWorker()));
  return results;
}

export const AgentPathRemovalDefaults = Object.freeze({
  maxAttempts: 6,
  retryDelayMs: 100,
});

export const AgentFileAccessRetryDefaults = Object.freeze({
  maxDurationMs: 500,
  retryDelayMs: 25,
});

const RetryablePathRemovalErrorCodes = new Set(["EBUSY", "EACCES", "EMFILE", "ENFILE", "ENOTEMPTY", "EPERM"]);
const DeferrablePathRemovalErrorCodes = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);
const RetryableFileAccessErrorCodes = new Set(["EBUSY", "EACCES", "EMFILE", "ENFILE", "EPERM"]);

export interface AgentFileAccessRetryOptions {
  /** Maximum time spent waiting for a transient file lock to clear. */
  maxDurationMs?: number;
  /** Delay between attempts. */
  retryDelayMs?: number;
}

export interface AgentPathRemovalOptions {
  /** Number of remove attempts before the operation is considered blocked. */
  maxAttempts?: number;
  /** Delay between attempts. A zero delay is useful for deterministic tests. */
  retryDelayMs?: number;
  /** Removes directories recursively when set. */
  recursive?: boolean;
  /** Renames a still-locked path out of the active namespace after retries. */
  deferOnBusy?: boolean;
}

export interface AgentPathCopyOptions {
  /** Copies directories recursively when set. */
  recursive?: boolean;
  /** Replaces existing files or directories when set. */
  force?: boolean;
  /** Fails when the destination entry already exists. */
  errorOnExist?: boolean;
  /** Skips a source entry when the predicate returns false. */
  filter?: (sourcePath: string) => boolean;
}

export type AgentPathRemovalResult = "removed" | "deferred";

/**
 * Reads and inspects may race with an editor, browser, or producer replacing a
 * file. Retry only operating-system lock/resource errors; permanent failures
 * still surface to the caller with their original error.
 */
export async function withAgentFileAccessRetry<T>(
  operation: () => Promise<T>,
  options: AgentFileAccessRetryOptions = {},
): Promise<T> {
  const maxDurationMs = resolveNonNegativeInteger(
    options.maxDurationMs ?? AgentFileAccessRetryDefaults.maxDurationMs,
    "maxDurationMs",
  );
  const retryDelayMs = resolveNonNegativeInteger(
    options.retryDelayMs ?? AgentFileAccessRetryDefaults.retryDelayMs,
    "retryDelayMs",
  );
  const deadline = Date.now() + maxDurationMs;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!RetryableFileAccessErrorCodes.has(nodeErrorCode(error) ?? "") || Date.now() >= deadline) {
        throw error;
      }
      const remaining = deadline - Date.now();
      await waitForPathRemovalRetry(Math.min(retryDelayMs, Math.max(1, remaining)));
    }
  }
}

/**
 * Removes a managed path without turning transient Windows locks into a
 * request failure. A deferred path gets a non-semantic suffix so session
 * enumerators and other namespace readers will ignore it until cleanup.
 */
export async function removeAgentPathWithRetry(
  targetPath: string,
  options: AgentPathRemovalOptions = {},
): Promise<AgentPathRemovalResult> {
  if (targetPath.trim().length === 0) throw new Error("Managed path must be non-empty.");
  const maxAttempts = resolvePositiveInteger(
    options.maxAttempts ?? AgentPathRemovalDefaults.maxAttempts,
    "maxAttempts",
  );
  const retryDelayMs = resolveNonNegativeInteger(
    options.retryDelayMs ?? AgentPathRemovalDefaults.retryDelayMs,
    "retryDelayMs",
  );
  const recursive = options.recursive ?? false;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await removeAgentPathOnce(targetPath, recursive);
      return "removed";
    } catch (error) {
      if (isMissingFileError(error)) return "removed";
      lastError = error;
      if (!isRetryablePathRemovalError(error) || attempt + 1 >= maxAttempts) break;
      await waitForPathRemovalRetry(retryDelayMs * (attempt + 1));
    }
  }

  if (options.deferOnBusy && isDeferrablePathRemovalError(lastError)) {
    const deferredPath = `${targetPath}.pending-delete-${randomUUID()}`;
    try {
      await fs.promises.rename(targetPath, deferredPath);
      return "deferred";
    } catch (error) {
      if (isMissingFileError(error)) return "removed";
      throw error;
    }
  }

  throw lastError ?? new Error(`Unable to remove managed path: ${targetPath}`);
}

/** Removes a managed path synchronously without Node's Windows `rm` path walker. */
export function removeAgentPathSync(targetPath: string, options: { recursive?: boolean; force?: boolean } = {}): void {
  const recursive = options.recursive ?? false;
  const force = options.force ?? false;
  try {
    removeAgentPathOnceSync(targetPath, recursive);
  } catch (error) {
    if (force && isMissingFileError(error)) return;
    throw error;
  }
}

/**
 * Copies a managed path without Node's Windows `cp` walker. Node 24 can
 * terminate the process while copying a non-ASCII path, so workspace-owned
 * copies use the same lstat/readdir primitives as managed deletion.
 */
export function copyAgentPathSync(sourcePath: string, targetPath: string, options: AgentPathCopyOptions = {}): void {
  if (options.filter && !options.filter(sourcePath)) return;
  const source = fs.lstatSync(sourcePath);
  const existing = readPathStatsSync(targetPath);
  const force = options.force ?? false;
  const errorOnExist = options.errorOnExist ?? false;
  if (existing && errorOnExist) throw createPathExistsError(targetPath);

  if (source.isSymbolicLink()) {
    if (existing) {
      if (!force) return;
      removeAgentPathSync(targetPath, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const link = fs.readlinkSync(sourcePath);
    let linkType: "junction" | "file" = "file";
    try {
      linkType = fs.statSync(sourcePath).isDirectory() ? "junction" : "file";
    } catch {
      // A dangling link is still copied as a link; the target does not need to resolve.
    }
    fs.symlinkSync(link, targetPath, linkType);
    return;
  }

  if (source.isDirectory()) {
    if (!options.recursive) throw new Error(`Cannot copy directory without recursive mode: ${sourcePath}`);
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
      if (!force) return;
      removeAgentPathSync(targetPath, { recursive: true, force: true });
    }
    fs.mkdirSync(targetPath, { recursive: true });
    preserveFileMode(targetPath, source.mode);
    for (const entry of fs.readdirSync(sourcePath)) {
      copyAgentPathSync(path.join(sourcePath, entry), path.join(targetPath, entry), options);
    }
    return;
  }

  if (existing) {
    if (!force) return;
    removeAgentPathSync(targetPath, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  preserveFileMode(targetPath, source.mode);
}

export interface AgentRegularTextFileSnapshot {
  readonly content: string;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly size: number;
}

export function readRegularTextFileSnapshotSync(
  filePath: string,
  subject = "File",
  previous?: AgentRegularTextFileSnapshot,
): AgentRegularTextFileSnapshot {
  const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) throw new Error(`${subject} is not a regular file: ${filePath}`);
    if (
      previous &&
      previous.mtimeMs === stat.mtimeMs &&
      previous.ctimeMs === stat.ctimeMs &&
      previous.size === stat.size
    ) {
      return previous;
    }
    return {
      content: fs.readFileSync(descriptor, "utf8"),
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      size: stat.size,
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

export function readRegularTextFileSync(filePath: string, subject = "File"): string {
  return readRegularTextFileSnapshotSync(filePath, subject).content;
}

export function readRegularFileSync(
  filePath: string,
  subject = "File",
  options: { readonly maxBytes?: number } = {},
): Buffer {
  const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) throw new Error(`${subject} is not a regular file: ${filePath}`);
    if (options.maxBytes !== undefined && stat.size > options.maxBytes) {
      throw new Error(`${subject} exceeds the ${options.maxBytes} byte limit: ${filePath}`);
    }
    return fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

export interface AgentAtomicWriteOptions {
  /** 目标文件权限（如 0o600）。 */
  mode?: number;
  /** 自动创建父目录时使用的权限（如 0o700）。 */
  directoryMode?: number;
  /** rename 前 fsync 文件内容，用于崩溃一致性要求高的产物。 */
  fsync?: boolean;
}

/**
 * 临时文件 + rename 的原子写。临时文件名含 pid 与随机段避免并发碰撞，
 * 失败路径一定清理临时文件（此前多处手写实现漏了这一步）。
 */
export function writeFileAtomicSync(
  filePath: string,
  data: string | Uint8Array,
  options: AgentAtomicWriteOptions = {},
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: options.directoryMode });
  const temporaryPath = temporaryPathFor(filePath);
  try {
    if (options.fsync) {
      const handle = fs.openSync(temporaryPath, "wx", options.mode);
      try {
        fs.writeFileSync(handle, data);
        fs.fsyncSync(handle);
      } finally {
        fs.closeSync(handle);
      }
    } else {
      fs.writeFileSync(temporaryPath, data, { flag: "wx", mode: options.mode });
    }
    fs.renameSync(temporaryPath, filePath);
  } finally {
    unlinkFileIfPresentSync(temporaryPath);
  }
}

export async function writeFileAtomic(
  filePath: string,
  data: string | Uint8Array,
  options: AgentAtomicWriteOptions = {},
): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true, mode: options.directoryMode });
  const temporaryPath = temporaryPathFor(filePath);
  try {
    const handle = await fs.promises.open(temporaryPath, "wx", options.mode);
    try {
      await handle.writeFile(data);
      if (options.fsync) await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(temporaryPath, filePath);
  } finally {
    await unlinkFileIfPresent(temporaryPath);
  }
}

function unlinkFileIfPresentSync(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (nodeErrorCode(error) !== "ENOENT") throw error;
  }
}

async function unlinkFileIfPresent(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (nodeErrorCode(error) !== "ENOENT") throw error;
  }
}

async function removeAgentPathOnce(targetPath: string, recursive: boolean): Promise<void> {
  let entry: fs.Stats;
  try {
    entry = await fs.promises.lstat(targetPath);
  } catch (error) {
    if (isMissingFileError(error)) return;
    throw error;
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    await fs.promises.unlink(targetPath);
    return;
  }
  if (!recursive) {
    await fs.promises.rmdir(targetPath);
    return;
  }
  for (const child of await fs.promises.readdir(targetPath)) {
    await removeAgentPathOnce(path.join(targetPath, child), true);
  }
  await fs.promises.rmdir(targetPath);
}

function removeAgentPathOnceSync(targetPath: string, recursive: boolean): void {
  let entry: fs.Stats;
  try {
    entry = fs.lstatSync(targetPath);
  } catch (error) {
    if (isMissingFileError(error)) return;
    throw error;
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    fs.unlinkSync(targetPath);
    return;
  }
  if (!recursive) {
    fs.rmdirSync(targetPath);
    return;
  }
  for (const child of fs.readdirSync(targetPath)) {
    removeAgentPathOnceSync(path.join(targetPath, child), true);
  }
  fs.rmdirSync(targetPath);
}

function readPathStatsSync(targetPath: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(targetPath);
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}

function createPathExistsError(targetPath: string): NodeJS.ErrnoException {
  const error = new Error(`Destination already exists: ${targetPath}`) as NodeJS.ErrnoException;
  error.code = "EEXIST";
  return error;
}

function preserveFileMode(filePath: string, mode: number): void {
  if (process.platform !== "win32") fs.chmodSync(filePath, mode & 0o777);
}

function temporaryPathFor(filePath: string): string {
  return `${filePath}.${process.pid}.${randomUUID()}.tmp`;
}

function isRetryablePathRemovalError(error: unknown): boolean {
  return RetryablePathRemovalErrorCodes.has(nodeErrorCode(error) ?? "");
}

function isDeferrablePathRemovalError(error: unknown): boolean {
  return DeferrablePathRemovalErrorCodes.has(nodeErrorCode(error) ?? "");
}

function resolvePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer.`);
  return value;
}

function resolveNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer.`);
  return value;
}

function waitForPathRemovalRetry(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
