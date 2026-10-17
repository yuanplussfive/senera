import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { projectAgentSelfRedacted } from "../SelfService/AgentSelfRedaction.js";
import { AgentLogPolicyLimits } from "../Types/AgentLogPolicyLimits.js";
import type {
  AgentWorkspaceLogPolicy,
  AgentWorkspaceLogQuery,
  AgentWorkspaceLogRecord,
} from "./AgentWorkspaceLogStore.js";

export const AgentWorkspaceLogSchemaVersion = 1 as const;
export const AgentWorkspaceLogStreamNames = {
  foreground: "foreground",
  memos: "background/memos",
  learning: "background/learning",
} as const;

export const AgentWorkspaceLogCursorVersion = 1 as const;

export interface AgentWorkspaceLogCursorQuery {
  readonly from?: string;
  readonly to?: string;
  readonly order: "asc" | "desc";
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly kind?: string;
  readonly level?: string;
  readonly scope?: string;
  readonly stream?: string;
}

export interface AgentWorkspaceLogCursorPosition {
  readonly timestamp: string;
  readonly recordId: string;
}

export interface AgentWorkspaceLogCursor {
  readonly version: typeof AgentWorkspaceLogCursorVersion;
  readonly query: AgentWorkspaceLogCursorQuery;
  readonly position: AgentWorkspaceLogCursorPosition;
}

interface NormalizedAgentWorkspaceLogQuery extends AgentWorkspaceLogQuery {
  readonly from?: string;
  readonly to?: string;
  readonly fromMs?: number;
  readonly toMs?: number;
  readonly order: "asc" | "desc";
  readonly limit: number;
  readonly legacyAfter?: string;
  readonly position?: AgentWorkspaceLogCursorPosition;
}

export function assertPolicy(policy: AgentWorkspaceLogPolicy): AgentWorkspaceLogPolicy {
  if (
    !Number.isSafeInteger(policy.detailMaxBytes) ||
    policy.detailMaxBytes < AgentLogPolicyLimits.minimumDetailMaxBytes
  ) {
    throw new RangeError(`日志详情上限必须是至少 ${AgentLogPolicyLimits.minimumDetailMaxBytes} 字节的安全整数。`);
  }
  if (!Number.isSafeInteger(policy.projectionMaxBytes) || policy.projectionMaxBytes <= 0) {
    throw new RangeError("日志投影上限必须是正整数。 ");
  }
  if (!Number.isSafeInteger(policy.retentionHours) || policy.retentionHours <= 0) {
    throw new RangeError("日志保留时间必须是正整数。 ");
  }
  if (
    !Number.isSafeInteger(policy.queryPageSize) ||
    policy.queryPageSize <= 0 ||
    policy.queryPageSize > AgentLogPolicyLimits.maximumQueryPageSize
  ) {
    throw new RangeError(`日志默认分页大小必须是 1-${AgentLogPolicyLimits.maximumQueryPageSize} 的安全整数。`);
  }
  if (
    !Number.isSafeInteger(policy.tailLineCount) ||
    policy.tailLineCount <= 0 ||
    policy.tailLineCount > AgentLogPolicyLimits.maximumTailLineCount
  ) {
    throw new RangeError(`日志默认尾部行数必须是 1-${AgentLogPolicyLimits.maximumTailLineCount} 的安全整数。`);
  }
  return policy;
}

export function normalizeLimit(value: number | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  if (!Number.isSafeInteger(value) || value <= 0 || value > AgentLogPolicyLimits.maximumQueryPageSize) {
    throw new RangeError(`日志查询 limit 必须是 1-${AgentLogPolicyLimits.maximumQueryPageSize} 的安全整数。`);
  }
  return value;
}

export function normalizeTailLineCount(value: number | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  if (!Number.isSafeInteger(value) || value <= 0 || value > AgentLogPolicyLimits.maximumTailLineCount) {
    throw new RangeError(`日志读取行数必须是 1-${AgentLogPolicyLimits.maximumTailLineCount} 的安全整数。`);
  }
  return value;
}

export function normalizeLogQuery(
  input: AgentWorkspaceLogQuery,
  root: string,
  defaultLimit: number,
): NormalizedAgentWorkspaceLogQuery {
  if (input.cursor !== undefined && input.after !== undefined) {
    throw new RangeError("日志查询不能同时使用 cursor 和 after。 ");
  }
  const continuation = input.cursor ?? input.after;
  const decoded = continuation ? decodeQueryCursor(continuation) : undefined;
  const cursorQuery = decoded?.kind === "query" ? decoded.value.query : undefined;
  if (cursorQuery && hasExplicitLogQueryFields(input) && !sameCursorQuery(input, cursorQuery)) {
    throw new RangeError("日志游标与当前查询条件不一致，请直接使用 logs next。 ");
  }

  const source = cursorQuery ?? input;
  const order = source.order ?? "asc";
  const projected = projectCursorQuery({ ...source, order });
  const fromMs = parseLogBoundary(projected.from, "from");
  const toMs = parseLogBoundary(projected.to, "to");
  if (fromMs !== undefined && toMs !== undefined && fromMs > toMs) {
    throw new RangeError("日志时间范围的 from 不能晚于 to。 ");
  }
  if (order !== "asc" && order !== "desc") throw new RangeError("日志排序方向无效。 ");
  const stream = projected.stream;
  if (stream && !resolveStreamProjectionPath(root, stream)) {
    throw new RangeError(`日志流名称无效: ${stream}`);
  }
  return {
    ...source,
    ...projected,
    ...(fromMs === undefined ? {} : { from: new Date(fromMs).toISOString(), fromMs }),
    ...(toMs === undefined ? {} : { to: new Date(toMs).toISOString(), toMs }),
    ...(stream === undefined ? { stream: undefined } : { stream }),
    order,
    limit: normalizeLimit(input.limit, defaultLimit),
    ...(decoded?.kind === "legacy" ? { legacyAfter: decoded.recordId } : {}),
    ...(decoded?.kind === "query" ? { position: decoded.value.position } : {}),
  };
}

export function hasExplicitLogQueryFields(query: AgentWorkspaceLogQuery): boolean {
  return [
    query.from,
    query.to,
    query.order,
    query.sessionId,
    query.requestId,
    query.kind,
    query.level,
    query.scope,
    query.stream,
  ].some((value) => value !== undefined);
}

export function sameCursorQuery(query: AgentWorkspaceLogQuery, cursorQuery: AgentWorkspaceLogCursorQuery): boolean {
  const projected = projectCursorQuery(query);
  const keys: readonly (keyof AgentWorkspaceLogCursorQuery)[] = [
    "from",
    "to",
    "order",
    "sessionId",
    "requestId",
    "kind",
    "level",
    "scope",
    "stream",
  ];
  return keys.every((key) => (key === "order" && query.order === undefined) || projected[key] === cursorQuery[key]);
}

export function projectCursorQuery(query: AgentWorkspaceLogQuery): AgentWorkspaceLogCursorQuery {
  const from = normalizeCursorBoundary(query.from, "from");
  const to = normalizeCursorBoundary(query.to, "to");
  const sessionId = normalizeQueryField(query.sessionId, "sessionId");
  const requestId = normalizeQueryField(query.requestId, "requestId");
  const kind = normalizeQueryField(query.kind, "kind");
  const level = normalizeQueryField(query.level, "level");
  const scope = normalizeQueryField(query.scope, "scope");
  const stream = normalizeQueryField(query.stream, "stream");
  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    order: query.order ?? "asc",
    ...(sessionId ? { sessionId } : {}),
    ...(requestId ? { requestId } : {}),
    ...(kind ? { kind } : {}),
    ...(level ? { level } : {}),
    ...(scope ? { scope } : {}),
    ...(stream ? { stream } : {}),
  };
}

export function normalizeCursorBoundary(value: string | undefined, name: string): string | undefined {
  const normalized = normalizeQueryField(value, name);
  if (normalized === undefined) return undefined;
  return new Date(parseLogBoundary(normalized, name)!).toISOString();
}

export function normalizeQueryField(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) throw new RangeError(`日志查询 ${name} 不能是空字符串。`);
  return normalized;
}

export function parseLogBoundary(value: string | undefined, name: string): number | undefined {
  const normalized = normalizeOptionalText(value);
  if (normalized === undefined) return undefined;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) throw new RangeError(`日志时间边界 ${name} 必须是有效的 RFC3339 时间。`);
  return parsed;
}

export function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function matchesRecord(record: AgentWorkspaceLogRecord, query: NormalizedAgentWorkspaceLogQuery): boolean {
  const timestampMs = Date.parse(record.timestamp);
  return (
    (query.fromMs === undefined || (Number.isFinite(timestampMs) && timestampMs >= query.fromMs)) &&
    (query.toMs === undefined || (Number.isFinite(timestampMs) && timestampMs <= query.toMs)) &&
    (!query.sessionId || record.sessionId === query.sessionId) &&
    (!query.requestId || record.requestId === query.requestId) &&
    (!query.kind || record.kind === query.kind) &&
    (!query.level || record.level === query.level) &&
    (!query.scope || record.scope === query.scope) &&
    (!query.stream || normalizeLogStream(record.stream) === normalizeLogStream(query.stream))
  );
}

export function compareLogRecords(
  left: AgentWorkspaceLogRecord,
  right: AgentWorkspaceLogRecord,
  order: "asc" | "desc",
): number {
  const comparison = compareLogPositions(
    { timestamp: left.timestamp, recordId: left.recordId },
    { timestamp: right.timestamp, recordId: right.recordId },
  );
  return order === "desc" ? -comparison : comparison;
}

export function compareRecordToPosition(
  record: AgentWorkspaceLogRecord,
  position: AgentWorkspaceLogCursorPosition,
  order: "asc" | "desc",
): number {
  const comparison = compareLogPositions({ timestamp: record.timestamp, recordId: record.recordId }, position);
  return order === "desc" ? -comparison : comparison;
}

export function compareLogPositions(
  left: AgentWorkspaceLogCursorPosition,
  right: AgentWorkspaceLogCursorPosition,
): number {
  const leftMs = Date.parse(left.timestamp);
  const rightMs = Date.parse(right.timestamp);
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) return leftMs - rightMs;
  if (Number.isFinite(leftMs) !== Number.isFinite(rightMs)) return Number.isFinite(leftMs) ? -1 : 1;
  return left.timestamp.localeCompare(right.timestamp) || left.recordId.localeCompare(right.recordId);
}

export function parseRecord(line: string, onError?: (error: string) => void): AgentWorkspaceLogRecord | undefined {
  try {
    const value = JSON.parse(line) as Partial<AgentWorkspaceLogRecord>;
    if (
      typeof value.recordId !== "string" ||
      typeof value.timestamp !== "string" ||
      typeof value.level !== "string" ||
      typeof value.message !== "string"
    ) {
      onError?.("日志投影记录缺少必要字段。");
      return undefined;
    }
    const schemaVersion = (value as Partial<AgentWorkspaceLogRecord> & { schemaVersion?: unknown }).schemaVersion;
    if (schemaVersion !== undefined && schemaVersion !== AgentWorkspaceLogSchemaVersion) {
      onError?.(`日志投影版本不受支持: ${String(schemaVersion)}`);
      return undefined;
    }
    return value as AgentWorkspaceLogRecord;
  } catch (error) {
    onError?.(`日志投影记录解析失败: ${errorMessage(error)}`);
    return undefined;
  }
}

export function* readLines(file: string, onError?: (error: string) => void): Generator<string> {
  const decoder = new StringDecoder("utf8");
  const buffer = Buffer.allocUnsafe(64 * 1_024);
  let descriptor: number | undefined;
  let remainder = "";
  try {
    descriptor = fs.openSync(file, "r");
    while (true) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      remainder += decoder.write(buffer.subarray(0, bytesRead));
      const lines = remainder.split(/\r?\n/);
      remainder = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length > 0) yield line;
      }
    }
    remainder += decoder.end();
    if (remainder.length > 0) yield remainder;
  } catch (error) {
    onError?.(`日志文件读取失败: ${file}: ${errorMessage(error)}`);
    throw error;
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch (error) {
        onError?.(`日志文件关闭失败: ${file}: ${errorMessage(error)}`);
      }
    }
  }
}

export function readTailLines(file: string, lineCount: number, onError?: (error: string) => void): string {
  const lines: string[] = [];
  for (const line of readLines(file, onError)) {
    lines.push(line);
    if (lines.length > lineCount) lines.shift();
  }
  return lines.join("\n");
}

export function listProjectionFiles(
  root: string,
  onError?: (error: string) => void,
  stream?: string,
): readonly string[] {
  const normalized = normalizeOptionalText(stream);
  const streamRoot =
    normalized && normalized !== AgentWorkspaceLogStreamNames.foreground
      ? path.dirname(resolveStreamProjectionPath(root, normalized) ?? root)
      : root;
  return listFilesRecursively(streamRoot, onError)
    .filter((file) => file.relativePath.endsWith(".jsonl"))
    .filter(
      (file) =>
        !normalized || normalized !== AgentWorkspaceLogStreamNames.foreground || !file.relativePath.includes("/"),
    )
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
    .map((file) => file.absolutePath);
}

export function listFilesRecursively(
  root: string,
  onError?: (error: string) => void,
): Array<{
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly updatedAt: string;
}> {
  return listFilesRecursivelyWithErrors(root, onError);
}

export function listFilesRecursivelyWithErrors(
  root: string,
  onError?: (error: string) => void,
): Array<{
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly updatedAt: string;
}> {
  const files: Array<{ absolutePath: string; relativePath: string; sizeBytes: number; updatedAt: string }> = [];
  const visit = (directory: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      onError?.(`日志目录读取失败: ${directory}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      if (!entry.isFile()) continue;
      try {
        const stat = fs.statSync(absolutePath);
        files.push({
          absolutePath,
          relativePath: path.relative(root, absolutePath).split(path.sep).join("/"),
          sizeBytes: stat.size,
          updatedAt: stat.mtime.toISOString(),
        });
      } catch (error) {
        onError?.(`日志文件状态读取失败: ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  visit(root);
  return files;
}

export function resolveWorkspaceLogPath(root: string, name: string): string | undefined {
  const normalized = name.trim();
  if (!normalized || path.isAbsolute(normalized)) return undefined;
  const target = path.resolve(root, normalized);
  const relative = path.relative(root, target);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined;
  return containsSymlinkComponent(root, target) ? undefined : target;
}

export function resolveStreamProjectionPath(root: string, stream: string | undefined): string | undefined {
  const normalized = normalizeLogStream(stream);
  if (normalized === AgentWorkspaceLogStreamNames.foreground) return path.join(root, "events.jsonl");
  if (!/^[a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)*$/u.test(normalized)) return undefined;
  return path.join(root, normalized, "events.jsonl");
}

export function normalizeLogStream(stream: string | undefined): string {
  return stream?.trim() || AgentWorkspaceLogStreamNames.foreground;
}

export function containsSymlinkComponent(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return true;
    } catch (error) {
      if (isMissingPathError(error)) return false;
      return true;
    }
  }
  return false;
}

export function isMissingPathError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function redactLogValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactLogValue(entry));
  if (typeof value === "string") {
    const wrapped = projectAgentSelfRedacted({ value });
    return wrapped && typeof wrapped === "object" && "value" in wrapped
      ? (wrapped as { value: unknown }).value
      : wrapped;
  }
  if (!value || typeof value !== "object") return value;
  const projected = projectAgentSelfRedacted(value);
  if (Array.isArray(projected)) return projected.map((entry) => redactLogValue(entry));
  if (!projected || typeof projected !== "object") return projected;
  return Object.fromEntries(Object.entries(projected).map(([key, entry]) => [key, redactLogValue(entry)]));
}

export function truncateUtf8(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) return value;
  if (maxBytes <= 3) return buffer.subarray(0, maxBytes).toString("utf8");
  return `${buffer.subarray(0, Math.max(0, maxBytes - 3)).toString("utf8")}...`;
}

export function encodeBoundedDetail(serialized: string, formatted: string, maxBytes: number): string {
  if (Buffer.byteLength(formatted, "utf8") <= maxBytes) return formatted;

  const originalBytes = Buffer.byteLength(formatted, "utf8");
  const encodeTruncated = (preview: string): string =>
    `${JSON.stringify({ truncated: true, originalBytes, preview })}\n`;
  const emptyPreview = encodeTruncated("");
  if (Buffer.byteLength(emptyPreview, "utf8") > maxBytes) {
    const minimal = `${JSON.stringify({ truncated: true })}\n`;
    return Buffer.byteLength(minimal, "utf8") <= maxBytes ? minimal : "null\n";
  }

  let lower = 0;
  let upper = Buffer.byteLength(serialized, "utf8");
  while (lower < upper) {
    const candidateBytes = Math.ceil((lower + upper) / 2);
    const candidate = encodeTruncated(truncateUtf8(serialized, candidateBytes));
    if (Buffer.byteLength(candidate, "utf8") <= maxBytes) lower = candidateBytes;
    else upper = candidateBytes - 1;
  }
  return encodeTruncated(truncateUtf8(serialized, lower));
}

export function encodeQueryCursor(query: NormalizedAgentWorkspaceLogQuery, record: AgentWorkspaceLogRecord): string {
  const payload: AgentWorkspaceLogCursor = {
    version: AgentWorkspaceLogCursorVersion,
    query: projectCursorQuery(query),
    position: { timestamp: record.timestamp, recordId: record.recordId },
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  if (encoded.length > AgentLogPolicyLimits.maximumQueryCursorLength) {
    throw new RangeError(`日志游标超过 ${AgentLogPolicyLimits.maximumQueryCursorLength} 个字符。`);
  }
  return encoded;
}

export function decodeQueryCursor(
  cursor: string,
):
  | { readonly kind: "query"; readonly value: AgentWorkspaceLogCursor }
  | { readonly kind: "legacy"; readonly recordId: string } {
  if (cursor.length > AgentLogPolicyLimits.maximumQueryCursorLength) throw new Error("日志游标过长。 ");
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (isSafeRecordId(decoded)) return { kind: "legacy", recordId: decoded };
  let value: unknown;
  try {
    value = JSON.parse(decoded);
  } catch {
    throw new Error("日志游标无效。 ");
  }
  if (!isLogCursor(value)) throw new Error("日志游标无效。 ");
  return { kind: "query", value };
}

export function isLogCursor(value: unknown): value is AgentWorkspaceLogCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as {
    version?: unknown;
    query?: unknown;
    position?: unknown;
  };
  if (candidate.version !== AgentWorkspaceLogCursorVersion) return false;
  if (!candidate.query || typeof candidate.query !== "object" || Array.isArray(candidate.query)) return false;
  if (!candidate.position || typeof candidate.position !== "object" || Array.isArray(candidate.position)) return false;
  const query = candidate.query as Record<string, unknown>;
  const position = candidate.position as Record<string, unknown>;
  if (query.order !== "asc" && query.order !== "desc") return false;
  if (typeof position.timestamp !== "string" || typeof position.recordId !== "string") return false;
  if (!isSafeRecordId(position.recordId)) return false;
  for (const key of ["from", "to", "sessionId", "requestId", "kind", "level", "scope", "stream"]) {
    if (query[key] !== undefined && typeof query[key] !== "string") return false;
  }
  return true;
}

export function isSafeRecordId(value: string | undefined): value is string {
  return value !== undefined && /^[A-Za-z][A-Za-z0-9_-]{1,127}$/u.test(value);
}

export function isSafeDetailId(value: string | undefined): value is string {
  return value !== undefined && /^detail_[A-Za-z0-9-]{8,127}$/u.test(value);
}
