import fs from "node:fs/promises";
import path from "node:path";
import type Database from "better-sqlite3";
import { withAgentFileAccessRetry } from "../Core/AgentFs.js";
import { createOpaqueId } from "../Core/AgentIds.js";
import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import type { ToolWorkspaceFileContentSnapshot } from "../Types/ToolRuntimeTypes.js";
import {
  prepareAgentWorkspaceObserverSqlStatements,
  type AgentWorkspaceObserverSqlStatements,
} from "./AgentWorkspaceObserverSqlStatements.js";
import { AgentWorkspaceObserverStoreContract } from "./AgentWorkspaceObserverSqlSchema.js";

export interface AgentWorkspaceObserverBaselineRecord {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly size: number;
  readonly mtimeMs: number;
  readonly hash: string;
  readonly content: ToolWorkspaceFileContentSnapshot;
  readonly contentRef?: string;
}

interface WorkspaceObserverFileRow {
  readonly path_key: string;
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly size: number;
  readonly mtime_ms: number;
  readonly hash: string;
  readonly content_state: "captured" | "omitted";
  readonly content_reason: string | null;
  readonly content_ref: string | null;
  readonly content_byte_length: number | null;
  readonly line_count: number | null;
  readonly scan_generation: string;
}

type WorkspaceObserverFileWrite = {
  readonly path_key: string;
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly size: number;
  readonly mtime_ms: number;
  readonly hash: string;
  readonly content_state: "captured" | "omitted";
  readonly content_reason: string | null;
  readonly content_ref: string | null;
  readonly content_byte_length: number | null;
  readonly line_count: number | null;
  readonly scan_generation: string;
};

export class AgentWorkspaceObserverSqliteStore {
  private readonly kernel: AgentSqliteDatabaseKernel;
  private readonly db: Database.Database;
  private readonly statements: AgentWorkspaceObserverSqlStatements;
  private readonly replaceSubtreeTransaction: (
    prefix: string,
    pattern: string,
    entries: readonly (readonly [string, AgentWorkspaceObserverBaselineRecord])[],
  ) => void;
  private scanGeneration?: string;

  constructor(
    databasePath: string,
    private readonly contentRoot: string,
  ) {
    this.kernel = new AgentSqliteDatabaseKernel({
      databasePath,
      contract: AgentWorkspaceObserverStoreContract,
      extensions: [],
    });
    this.db = this.kernel.connection;
    this.statements = prepareAgentWorkspaceObserverSqlStatements(this.db);
    this.replaceSubtreeTransaction = this.db.transaction(
      (
        prefix: string,
        pattern: string,
        entries: readonly (readonly [string, AgentWorkspaceObserverBaselineRecord])[],
      ) => {
        this.statements.deleteSubtree.run(prefix, pattern);
        for (const [key, entry] of entries) this.writeRecord(key, entry);
      },
    );
  }

  get(pathKey: string): AgentWorkspaceObserverBaselineRecord | undefined {
    const row = this.statements.selectFile.get(pathKey) as WorkspaceObserverFileRow | undefined;
    return row ? decodeRecord(row) : undefined;
  }

  *iterateSubtree(prefix: string): Iterable<readonly [string, AgentWorkspaceObserverBaselineRecord]> {
    const rows = this.statements.listSubtree.iterate(
      prefix,
      subtreePattern(prefix),
    ) as Iterable<WorkspaceObserverFileRow>;
    for (const row of rows) yield [row.path_key, decodeRecord(row)];
  }

  upsert(pathKey: string, entry: AgentWorkspaceObserverBaselineRecord): void {
    this.writeRecord(pathKey, entry);
  }

  remove(pathKey: string): void {
    this.statements.deleteFile.run(pathKey);
  }

  removeSubtree(prefix: string): void {
    this.statements.deleteSubtree.run(prefix, subtreePattern(prefix));
  }

  replaceSubtree(prefix: string, entries: readonly (readonly [string, AgentWorkspaceObserverBaselineRecord])[]): void {
    this.replaceSubtreeTransaction(prefix, subtreePattern(prefix), entries);
  }

  beginReconciliation(): string {
    if (this.scanGeneration) throw new Error("Workspace observer baseline reconciliation is already active.");
    this.scanGeneration = createOpaqueId("workspace-scan");
    return this.scanGeneration;
  }

  finishReconciliation(generation: string, complete: boolean): void {
    if (this.scanGeneration !== generation) {
      throw new Error("Workspace observer baseline reconciliation generation does not match the active scan.");
    }
    if (complete) this.statements.deleteOtherScanGenerations.run(generation);
    this.scanGeneration = undefined;
  }

  async saveText(contentRef: string, text: string): Promise<void> {
    const filePath = this.contentPath(contentRef);
    await withAgentFileAccessRetry(() => fs.mkdir(this.contentRoot, { recursive: true }));
    try {
      await withAgentFileAccessRetry(() => fs.access(filePath));
      return;
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
    const temporaryPath = `${filePath}.${createOpaqueId("workspace-content")}.tmp`;
    try {
      await withAgentFileAccessRetry(() => fs.writeFile(temporaryPath, text, "utf8"));
      await withAgentFileAccessRetry(() => fs.rename(temporaryPath, filePath));
    } finally {
      await fs.rm(temporaryPath, { force: true });
    }
  }

  async readText(contentRef: string): Promise<string> {
    return withAgentFileAccessRetry(() => fs.readFile(this.contentPath(contentRef), "utf8"));
  }

  close(): void {
    this.kernel.close();
  }

  private writeRecord(pathKey: string, entry: AgentWorkspaceObserverBaselineRecord): void {
    this.statements.insertFile.run({ ...encodeRecord(pathKey, entry), scan_generation: this.scanGeneration ?? "" });
  }

  private contentPath(contentRef: string): string {
    if (!/^[a-f0-9]{64}$/u.test(contentRef)) {
      throw new Error("Workspace observer content references must be SHA-256 hex digests.");
    }
    return path.join(this.contentRoot, `${contentRef}.txt`);
  }
}

function encodeRecord(pathKey: string, entry: AgentWorkspaceObserverBaselineRecord): WorkspaceObserverFileWrite {
  if (entry.content.state === "captured") {
    if (!entry.contentRef) throw new Error(`Captured workspace file ${entry.path} is missing a content reference.`);
    return {
      path_key: pathKey,
      path: entry.path,
      kind: entry.kind,
      size: entry.size,
      mtime_ms: entry.mtimeMs,
      hash: entry.hash,
      content_state: "captured",
      content_reason: null,
      content_ref: entry.contentRef,
      content_byte_length: entry.content.byteLength,
      line_count: entry.content.lineCount,
      scan_generation: "",
    };
  }
  return {
    path_key: pathKey,
    path: entry.path,
    kind: entry.kind,
    size: entry.size,
    mtime_ms: entry.mtimeMs,
    hash: entry.hash,
    content_state: "omitted",
    content_reason: entry.content.reason,
    content_ref: null,
    content_byte_length: entry.content.byteLength ?? null,
    line_count: null,
    scan_generation: "",
  };
}

function decodeRecord(row: WorkspaceObserverFileRow): AgentWorkspaceObserverBaselineRecord {
  if (row.content_state === "captured") {
    if (!row.content_ref || row.content_byte_length === null || row.line_count === null) {
      throw new Error(`Workspace observer baseline row ${row.path_key} has incomplete captured content metadata.`);
    }
    return {
      path: row.path,
      kind: row.kind,
      size: row.size,
      mtimeMs: row.mtime_ms,
      hash: row.hash,
      content: {
        state: "captured",
        encoding: "utf8",
        byteLength: row.content_byte_length,
        lineCount: row.line_count,
      },
      contentRef: row.content_ref,
    };
  }
  if (!row.content_reason)
    throw new Error(`Workspace observer baseline row ${row.path_key} is missing an omission reason.`);
  return {
    path: row.path,
    kind: row.kind,
    size: row.size,
    mtimeMs: row.mtime_ms,
    hash: row.hash,
    content: {
      state: "omitted",
      reason: row.content_reason as Exclude<ToolWorkspaceFileContentSnapshot, { state: "captured" }>["reason"],
      ...(row.content_byte_length === null ? {} : { byteLength: row.content_byte_length }),
    },
  };
}

function subtreePattern(prefix: string): string {
  if (!prefix) return "%";
  return `${prefix.replace(/[\\%_]/gu, "\\$&")}/%`;
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
