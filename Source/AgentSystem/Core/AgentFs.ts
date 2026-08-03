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
    fs.rmSync(temporaryPath, { force: true });
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
    await fs.promises.rm(temporaryPath, { force: true });
  }
}

function temporaryPathFor(filePath: string): string {
  return `${filePath}.${process.pid}.${randomUUID()}.tmp`;
}
