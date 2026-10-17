import fs from "node:fs";
import path from "node:path";
import { createOpaqueId } from "../Core/AgentIds.js";
import { serializeError } from "./AgentErrorSerializer.js";
import {
  AgentWorkspaceLogSchemaVersion,
  AgentWorkspaceLogStreamNames,
  assertPolicy,
  compareLogRecords,
  compareRecordToPosition,
  containsSymlinkComponent,
  encodeBoundedDetail,
  encodeQueryCursor,
  errorMessage,
  isMissingPathError,
  isSafeDetailId,
  isSafeRecordId,
  listFilesRecursively,
  listProjectionFiles,
  matchesRecord,
  normalizeLogQuery,
  normalizeLogStream,
  normalizeTailLineCount,
  parseRecord,
  readLines,
  readTailLines,
  redactLogValue,
  resolveStreamProjectionPath,
  resolveWorkspaceLogPath,
} from "./AgentWorkspaceLogStoreSupport.js";

export { AgentWorkspaceLogSchemaVersion, AgentWorkspaceLogStreamNames };

export interface AgentWorkspaceLogPolicy {
  readonly enabled: boolean;
  readonly detailMaxBytes: number;
  readonly projectionMaxBytes: number;
  readonly retentionHours: number;
  readonly queryPageSize: number;
  readonly tailLineCount: number;
}

export interface AgentWorkspaceLogRecord {
  readonly recordId: string;
  readonly timestamp: string;
  readonly level: string;
  readonly message: string;
  readonly eventId?: string;
  readonly kind?: string;
  readonly layer?: string;
  readonly phase?: string;
  readonly scope?: string;
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly step?: number;
  readonly detailId?: string;
  readonly stream?: string;
  readonly details?: unknown;
  readonly tokens?: readonly string[];
}

export interface AgentWorkspaceLogQuery {
  /** New opaque cursor used by the self-service `logs next` command. */
  readonly cursor?: string;
  /** Retained for direct store callers that still pass a record cursor. */
  readonly after?: string;
  readonly from?: string;
  readonly to?: string;
  readonly order?: "asc" | "desc";
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly kind?: string;
  readonly level?: string;
  readonly scope?: string;
  readonly stream?: string;
  readonly limit?: number;
}

export interface AgentWorkspaceLogQueryResult {
  readonly items: readonly AgentWorkspaceLogRecord[];
  readonly nextCursor?: string;
  readonly hasMore: boolean;
  readonly scanned: number;
}

export type AgentWorkspaceLogDetailResult =
  | { readonly status: "found"; readonly detailId: string; readonly value: unknown }
  | { readonly status: "missing"; readonly detailId: string; readonly error: string }
  | { readonly status: "rejected"; readonly detailId: string; readonly error: string };

export interface AgentWorkspaceLogHealth {
  readonly enabled: boolean;
  readonly root: string;
  readonly projectionPath: string;
  readonly detailRoot: string;
  readonly projectionFiles: number;
  readonly projectionBytes: number;
  readonly detailFiles: number;
  readonly lastError?: string;
}

export interface AgentWorkspaceLogStream {
  readonly name: string;
  readonly files: readonly { readonly name: string; readonly sizeBytes: number; readonly updatedAt?: string }[];
}

export interface AgentWorkspaceLogStoreOptions {
  readonly root: string;
  readonly policy: AgentWorkspaceLogPolicy | (() => AgentWorkspaceLogPolicy);
}

/**
 * Workspace-local structured log projection. Foreground run_events remain the
 * durable replay/index source; this store is the bounded, redacted projection
 * used by the CLI, Skills and human diagnostics.
 */
export class AgentWorkspaceLogStore {
  readonly root: string;
  readonly detailRoot: string;
  readonly referenceRoot: string;
  readonly projectionPath: string;
  private readonly policySource: () => AgentWorkspaceLogPolicy;
  private lastError: string | undefined;
  private initialized = false;
  private initializedRetentionHours: number | undefined;

  constructor(options: AgentWorkspaceLogStoreOptions) {
    this.root = path.resolve(options.root);
    this.detailRoot = path.join(this.root, "details");
    this.referenceRoot = path.join(this.root, "references");
    this.projectionPath = path.join(this.root, "events.jsonl");
    const policy = options.policy;
    this.policySource = typeof policy === "function" ? policy : () => policy;
    this.ensureInitialized();
  }

  append(record: AgentWorkspaceLogRecord): void {
    const policy = this.readPolicy();
    if (!policy?.enabled || !this.ensureInitialized(policy)) return;
    try {
      const stream = normalizeLogStream(record.stream);
      const projectionPath = resolveStreamProjectionPath(this.root, stream);
      if (!projectionPath) throw new Error(`日志流名称无效: ${record.stream ?? "foreground"}`);
      if (containsSymlinkComponent(this.root, projectionPath)) throw new Error("日志流路径包含不受信任的符号链接。");
      const detailId =
        record.details === undefined
          ? isSafeDetailId(record.detailId)
            ? record.detailId
            : undefined
          : isSafeDetailId(record.detailId)
            ? record.detailId
            : createOpaqueId("detail");
      const recordId = isSafeRecordId(record.recordId) ? record.recordId : createOpaqueId("log");
      if (record.details !== undefined && detailId) this.writeDetail(detailId, record.details, policy);
      fs.mkdirSync(path.dirname(projectionPath), { recursive: true, mode: 0o700 });
      this.rotateProjectionIfNeeded(projectionPath, policy);
      const projection = {
        schemaVersion: AgentWorkspaceLogSchemaVersion,
        ...record,
        recordId,
        stream: stream === AgentWorkspaceLogStreamNames.foreground ? undefined : stream,
        ...(detailId ? { detailId } : {}),
      };
      delete (projection as { details?: unknown }).details;
      fs.appendFileSync(projectionPath, `${JSON.stringify(projection)}\n`, "utf8");
      this.lastError = undefined;
    } catch (error) {
      this.lastError = errorMessage(error);
    }
  }

  listFiles(): readonly { readonly name: string; readonly sizeBytes: number; readonly updatedAt?: string }[] {
    const policy = this.readPolicy();
    if (!policy?.enabled || !this.ensureInitialized(policy)) return [];
    return listFilesRecursively(this.root, (error) => this.rememberError(error))
      .filter((file) => file.relativePath.endsWith(".jsonl") || file.relativePath.endsWith(".json"))
      .map((file) => ({ name: file.relativePath, sizeBytes: file.sizeBytes, updatedAt: file.updatedAt }))
      .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
  }

  listStreams(): readonly AgentWorkspaceLogStream[] {
    const policy = this.readPolicy();
    if (!policy?.enabled || !this.ensureInitialized(policy)) return [];
    const groups = new Map<
      string,
      Array<{ readonly name: string; readonly sizeBytes: number; readonly updatedAt?: string }>
    >();
    for (const file of this.listFiles()) {
      if (!file.name.endsWith(".jsonl")) continue;
      const marker = file.name.lastIndexOf("/");
      const stream = marker < 0 ? AgentWorkspaceLogStreamNames.foreground : file.name.slice(0, marker);
      const files = groups.get(stream) ?? [];
      files.push(file);
      groups.set(stream, files);
    }
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, files]) => ({ name, files }));
  }

  readFile(
    name: string,
    lines?: number,
  ): { status: "found"; content: string } | { status: "missing" | "rejected"; error: string } {
    const policy = this.readPolicy();
    if (!policy) return { status: "missing", error: this.unavailableMessage() };
    if (!policy.enabled) return { status: "missing", error: "当前工作区日志已关闭。" };
    if (!this.ensureInitialized(policy)) return { status: "missing", error: this.unavailableMessage() };
    const target = resolveWorkspaceLogPath(this.root, name);
    if (!target) return { status: "rejected", error: "日志文件路径越界。" };
    const lineCount = normalizeTailLineCount(lines, policy.tailLineCount);
    try {
      return { status: "found", content: readTailLines(target, lineCount, (error) => this.rememberError(error)) };
    } catch (error) {
      if (isMissingPathError(error)) return { status: "missing", error: `日志文件不存在: ${name}` };
      const message = `日志文件读取失败: ${name}: ${errorMessage(error)}`;
      this.rememberError(message);
      return { status: "missing", error: message };
    }
  }

  query(query: AgentWorkspaceLogQuery = {}): AgentWorkspaceLogQueryResult {
    const policy = this.readPolicy();
    if (!policy?.enabled || !this.ensureInitialized(policy)) return { items: [], hasMore: false, scanned: 0 };
    const normalized = normalizeLogQuery(query, this.root, policy.queryPageSize);
    // Keep only the requested page plus one record for hasMore. Projection
    // files can outlive many runs, so retaining every match would make a
    // bounded page query grow with the entire log history.
    const items: AgentWorkspaceLogRecord[] = [];
    const capacity = normalized.limit + 1;
    let scanned = 0;
    let foundLegacyAfter = normalized.legacyAfter === undefined;
    for (const file of listProjectionFiles(this.root, (error) => this.rememberError(error), normalized.stream)) {
      for (const line of readLines(file, (error) => this.rememberError(error))) {
        scanned += 1;
        const record = parseRecord(line, (error) => this.rememberError(error));
        if (!record) continue;
        if (!foundLegacyAfter) {
          if (record.recordId === normalized.legacyAfter) foundLegacyAfter = true;
          continue;
        }
        if (!matchesRecord(record, normalized)) continue;
        if (normalized.position && compareRecordToPosition(record, normalized.position, normalized.order) <= 0)
          continue;
        items.push(record);
        if (items.length > capacity) {
          items.sort((left, right) => compareLogRecords(left, right, normalized.order));
          items.pop();
        }
      }
    }
    if (normalized.legacyAfter !== undefined && !foundLegacyAfter) {
      throw new RangeError("日志游标已过期或不存在，请重新查询。 ");
    }
    items.sort((left, right) => compareLogRecords(left, right, normalized.order));
    const page = items.slice(0, normalized.limit);
    const hasMore = items.length > normalized.limit;
    const last = page[page.length - 1];
    return {
      items: page,
      ...(hasMore && last ? { nextCursor: encodeQueryCursor(normalized, last) } : {}),
      hasMore,
      scanned,
    };
  }

  detail(detailId: string): AgentWorkspaceLogDetailResult {
    const policy = this.readPolicy();
    if (!policy) return { status: "missing", detailId, error: this.unavailableMessage() };
    if (!policy.enabled) return { status: "missing", detailId, error: "当前工作区日志已关闭。" };
    if (!this.ensureInitialized(policy)) return { status: "missing", detailId, error: this.unavailableMessage() };
    const normalized = detailId.trim();
    if (!isSafeDetailId(normalized)) return { status: "rejected", detailId, error: "详情 ID 格式无效。" };
    const target = resolveWorkspaceLogPath(this.detailRoot, `${normalized}.json`);
    if (!target) return { status: "rejected", detailId, error: "详情路径越界。" };
    try {
      return { status: "found", detailId: normalized, value: JSON.parse(fs.readFileSync(target, "utf8")) };
    } catch (error) {
      if (isMissingPathError(error))
        return { status: "missing", detailId: normalized, error: `详情不存在: ${normalized}` };
      const message = `日志详情读取失败: ${normalized}: ${errorMessage(error)}`;
      this.rememberError(message);
      return { status: "missing", detailId: normalized, error: message };
    }
  }

  health(): AgentWorkspaceLogHealth {
    const policy = this.readPolicy();
    if (!policy?.enabled || !this.ensureInitialized(policy)) {
      return {
        enabled: Boolean(policy?.enabled),
        root: this.root,
        projectionPath: this.projectionPath,
        detailRoot: this.detailRoot,
        projectionFiles: 0,
        projectionBytes: 0,
        detailFiles: 0,
        ...(this.lastError ? { lastError: this.lastError } : {}),
      };
    }
    const projectionFiles = listProjectionFiles(this.root, (error) => this.rememberError(error));
    const projectionBytes = projectionFiles.reduce((total, file) => {
      try {
        return total + fs.statSync(file).size;
      } catch (error) {
        if (!isMissingPathError(error)) this.rememberError(`日志投影状态读取失败: ${errorMessage(error)}`);
        return total;
      }
    }, 0);
    let detailFiles: number;
    try {
      detailFiles = fs
        .readdirSync(this.detailRoot, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json")).length;
    } catch (error) {
      if (!isMissingPathError(error)) this.rememberError(`日志详情目录读取失败: ${errorMessage(error)}`);
      detailFiles = 0;
    }
    return {
      enabled: policy.enabled,
      root: this.root,
      projectionPath: this.projectionPath,
      detailRoot: this.detailRoot,
      projectionFiles: projectionFiles.length,
      projectionBytes,
      detailFiles,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  private initialize(policy: AgentWorkspaceLogPolicy): void {
    fs.mkdirSync(this.detailRoot, { recursive: true, mode: 0o700 });
    for (const stream of [AgentWorkspaceLogStreamNames.memos, AgentWorkspaceLogStreamNames.learning]) {
      fs.mkdirSync(path.join(this.root, ...stream.split("/")), { recursive: true, mode: 0o700 });
    }
    fs.mkdirSync(this.referenceRoot, { recursive: true, mode: 0o700 });
    const manifestPath = path.join(this.root, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      fs.writeFileSync(
        manifestPath,
        `${JSON.stringify({ schemaVersion: AgentWorkspaceLogSchemaVersion, createdAt: new Date().toISOString() }, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
    }
    this.pruneExpiredFiles(policy);
    this.initialized = true;
    this.initializedRetentionHours = policy.retentionHours;
  }

  private ensureInitialized(policy = this.readPolicy()): boolean {
    if (!policy?.enabled) return false;
    try {
      if (!this.initialized) this.initialize(policy);
      else if (this.initializedRetentionHours !== policy.retentionHours) {
        this.pruneExpiredFiles(policy);
        this.initializedRetentionHours = policy.retentionHours;
      }
      return true;
    } catch (error) {
      this.rememberError(`日志存储初始化失败: ${errorMessage(error)}`);
      return false;
    }
  }

  private unavailableMessage(): string {
    return this.lastError ? `日志存储不可用: ${this.lastError}` : "日志存储尚未就绪。";
  }

  private rememberError(error: string): void {
    this.lastError = error;
  }

  private readPolicy(): AgentWorkspaceLogPolicy | undefined {
    try {
      return assertPolicy(this.policySource());
    } catch (error) {
      this.rememberError(`日志策略无效: ${errorMessage(error)}`);
      return undefined;
    }
  }

  private writeDetail(detailId: string, value: unknown, policy: AgentWorkspaceLogPolicy): void {
    const target = path.join(this.detailRoot, `${detailId}.json`);
    if (containsSymlinkComponent(this.root, target)) throw new Error("日志详情路径包含不受信任的符号链接。");
    const redacted = redactLogValue(serializeError(value));
    const serialized = JSON.stringify(redacted) ?? "null";
    const formatted = `${JSON.stringify(redacted, null, 2)}\n`;
    const payload = encodeBoundedDetail(serialized, formatted, policy.detailMaxBytes);
    const staging = `${target}.${createOpaqueId("pending")}`;
    fs.writeFileSync(staging, payload, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(staging, target);
  }

  private rotateProjectionIfNeeded(projectionPath: string, policy: AgentWorkspaceLogPolicy): void {
    let size: number;
    try {
      size = fs.statSync(projectionPath).size;
    } catch {
      return;
    }
    if (size < policy.projectionMaxBytes) return;
    const rotated = path.join(
      path.dirname(projectionPath),
      `${path.basename(projectionPath, ".jsonl")}-${new Date().toISOString().replace(/[:.]/gu, "-")}-${createOpaqueId("segment")}.jsonl`,
    );
    fs.renameSync(projectionPath, rotated);
  }

  private pruneExpiredFiles(policy: AgentWorkspaceLogPolicy): void {
    const before = Date.now() - policy.retentionHours * 60 * 60 * 1_000;
    for (const file of listFilesRecursively(this.root, (error) => this.rememberError(error))) {
      if (path.basename(file.relativePath) === "manifest.json") continue;
      if (new Date(file.updatedAt ?? 0).getTime() >= before) continue;
      try {
        fs.rmSync(file.absolutePath, { force: true });
      } catch (error) {
        this.lastError = errorMessage(error);
      }
    }
  }
}
