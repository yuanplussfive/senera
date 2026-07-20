import { createReadStream } from "node:fs";
import { access, open, readdir, rename, rm, stat, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { createOpaqueId } from "../Core/AgentIds.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";

export interface AgentPiSessionHistoryMaintenanceOptions {
  sessionsRoot: string;
  dryRun?: boolean;
  signal?: AbortSignal;
  onFile?: (progress: AgentPiSessionHistoryMaintenanceProgress) => void | Promise<void>;
}

export interface AgentPiSessionHistoryMaintenanceProgress {
  scannedFiles: number;
  rewritableFiles: number;
  scannedEntries: number;
  rewritableEntries: number;
  invalidEntries: number;
  reclaimableBytes: number;
}

export interface AgentPiSessionHistoryMaintenanceResult extends AgentPiSessionHistoryMaintenanceProgress {
  sessionsRoot: string;
  dryRun: boolean;
  rewrittenFiles: number;
  rewrittenEntries: number;
  bytesBefore: number;
  bytesAfter: number;
}

interface MutableProgress extends AgentPiSessionHistoryMaintenanceProgress {
  rewrittenFiles: number;
  rewrittenEntries: number;
  bytesBefore: number;
  bytesAfter: number;
}

interface ProjectedLine {
  line: string;
  changed: boolean;
  invalid: boolean;
}

export class AgentPiSessionHistoryMaintenance {
  async compact(options: AgentPiSessionHistoryMaintenanceOptions): Promise<AgentPiSessionHistoryMaintenanceResult> {
    const sessionsRoot = path.resolve(options.sessionsRoot);
    await assertDirectory(sessionsRoot);
    const dryRun = options.dryRun ?? true;
    const progress = createProgress();

    for await (const filePath of listJsonlFiles(sessionsRoot, options.signal)) {
      throwIfAborted(options.signal);
      const result = await this.compactFile(filePath, dryRun, options.signal);
      progress.scannedFiles += 1;
      progress.scannedEntries += result.scannedEntries;
      progress.invalidEntries += result.invalidEntries;
      progress.bytesBefore += result.bytesBefore;
      progress.bytesAfter += result.bytesAfter;
      if (result.rewritableEntries > 0) {
        progress.rewritableFiles += 1;
        progress.rewritableEntries += result.rewritableEntries;
        progress.reclaimableBytes += result.reclaimableBytes;
      }
      if (result.rewritten) {
        progress.rewrittenFiles += 1;
        progress.rewrittenEntries += result.rewritableEntries;
      }
      await options.onFile?.(projectProgress(progress));
    }

    return {
      sessionsRoot,
      dryRun,
      ...progress,
    };
  }

  private async compactFile(
    filePath: string,
    dryRun: boolean,
    signal?: AbortSignal,
  ): Promise<{
    scannedEntries: number;
    rewritableEntries: number;
    invalidEntries: number;
    reclaimableBytes: number;
    bytesBefore: number;
    bytesAfter: number;
    rewritten: boolean;
  }> {
    const sourceStat = await stat(filePath);
    const temporaryPath = `${filePath}.senera-maintenance-${createOpaqueId("tmp")}`;
    let output: FileHandle | undefined;
    let scannedEntries = 0;
    let rewritableEntries = 0;
    let invalidEntries = 0;
    let reclaimableBytes = 0;

    try {
      if (!dryRun) output = await open(temporaryPath, "wx", sourceStat.mode);
      const reader = createInterface({
        input: createReadStream(filePath, { encoding: "utf8", signal }),
        crlfDelay: Infinity,
      });
      try {
        for await (const line of reader) {
          throwIfAborted(signal);
          scannedEntries += 1;
          const projected = projectPiSessionLine(line);
          if (projected.invalid) invalidEntries += 1;
          if (projected.changed) {
            rewritableEntries += 1;
            reclaimableBytes += Buffer.byteLength(line) - Buffer.byteLength(projected.line);
          }
          if (output) await output.write(`${projected.line}\n`);
        }
      } finally {
        reader.close();
      }

      if (output) {
        await output.sync();
        await output.close();
        output = undefined;
      }
      if (!dryRun && rewritableEntries > 0) {
        await replaceFileWithRollback(filePath, temporaryPath);
      } else if (!dryRun) {
        await rm(temporaryPath, { force: true });
      }
      return {
        scannedEntries,
        rewritableEntries,
        invalidEntries,
        reclaimableBytes,
        bytesBefore: sourceStat.size,
        bytesAfter: dryRun ? sourceStat.size - reclaimableBytes : (await stat(filePath)).size,
        rewritten: !dryRun && rewritableEntries > 0,
      };
    } finally {
      await output?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

function projectPiSessionLine(line: string): ProjectedLine {
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return { line, changed: false, invalid: true };
  }
  const record = readRecord(entry);
  const message = readRecord(record?.message);
  const details = readRecord(message?.details);
  const senera = readRecord(details?.senera);
  if (!record || !message || !details || !senera || (!("result" in senera) && !("executed" in senera))) {
    return { line, changed: false, invalid: false };
  }

  const executed = readRecord(senera.executed);
  const artifact = readRecord(executed?.artifact);
  const { result: _result, executed: _executed, ...metadata } = senera;
  const compactDetails = compactObject({
    ...metadata,
    toolName: metadata.toolName ?? executed?.name ?? message.toolName,
    artifactUri: metadata.artifactUri ?? artifact?.artifactUri,
    callId: metadata.callId ?? executed?.callId ?? message.toolCallId,
  });
  const projected = {
    ...record,
    message: {
      ...message,
      details: {
        ...details,
        senera: compactDetails,
      },
    },
  };
  return { line: JSON.stringify(projected), changed: true, invalid: false };
}

async function* listJsonlFiles(root: string, signal?: AbortSignal): AsyncGenerator<string> {
  const pending = [root];
  while (pending.length > 0) {
    throwIfAborted(signal);
    const directory = pending.pop();
    if (!directory) continue;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) yield entryPath;
    }
  }
}

async function replaceFileWithRollback(filePath: string, temporaryPath: string): Promise<void> {
  const backupPath = `${filePath}.senera-maintenance-${createOpaqueId("backup")}`;
  await rename(filePath, backupPath);
  try {
    await rename(temporaryPath, filePath);
    await rm(backupPath, { force: true });
  } catch (error) {
    await rm(filePath, { force: true }).catch(() => undefined);
    await rename(backupPath, filePath).catch(() => undefined);
    throw error;
  }
}

async function assertDirectory(directory: string): Promise<void> {
  await access(directory);
  if (!(await stat(directory)).isDirectory()) throw new Error(`Pi sessions root is not a directory: ${directory}`);
}

function createProgress(): MutableProgress {
  return {
    scannedFiles: 0,
    rewritableFiles: 0,
    scannedEntries: 0,
    rewritableEntries: 0,
    invalidEntries: 0,
    reclaimableBytes: 0,
    rewrittenFiles: 0,
    rewrittenEntries: 0,
    bytesBefore: 0,
    bytesAfter: 0,
  };
}

function projectProgress(progress: MutableProgress): AgentPiSessionHistoryMaintenanceProgress {
  return {
    scannedFiles: progress.scannedFiles,
    rewritableFiles: progress.rewritableFiles,
    scannedEntries: progress.scannedEntries,
    rewritableEntries: progress.rewritableEntries,
    invalidEntries: progress.invalidEntries,
    reclaimableBytes: progress.reclaimableBytes,
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
