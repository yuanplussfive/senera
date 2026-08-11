import type { EventEnvelope } from "../../api/eventTypes";
import { EventKinds, EventSpecs, type EventKind } from "../../api/generatedEventCatalog";

export const EventJournalProjectionMaxBytes = 64 * 1024;

export interface EventJournalProjection {
  readonly value?: Record<string, unknown>;
  readonly byteLength: number;
  readonly omitted: boolean;
  readonly summary?: string;
}

const encoder = new TextEncoder();

export function projectEventForJournal(envelope: EventEnvelope): EventJournalProjection {
  const observation = EventSpecs[envelope.kind as EventKind]?.observation;
  if (!observation || observation.retention === "metadata") {
    return { byteLength: 0, omitted: false };
  }

  const value: Record<string, unknown> = {};
  for (const pointer of observation.projectionPointers) {
    const selected = readJsonPointer(envelope, pointer);
    if (selected !== undefined) writeJsonPointer(value, pointer, selected);
  }
  if (Object.keys(value).length === 0) return { byteLength: 0, omitted: false };

  const serialized = JSON.stringify(value);
  const byteLength = encoder.encode(serialized).byteLength;
  if (byteLength > EventJournalProjectionMaxBytes) {
    return { byteLength: 0, omitted: true };
  }
  return {
    value,
    byteLength,
    omitted: false,
    summary: summarizeEvent(envelope.kind as EventKind, value),
  };
}

export function readJsonPointer(root: unknown, pointer: string): unknown {
  if (pointer === "") return root;
  if (!pointer.startsWith("/")) return undefined;
  let current = root;
  for (const token of decodeJsonPointer(pointer)) {
    if (Array.isArray(current)) {
      const index = readArrayIndex(token);
      if (index === undefined || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, token)) return undefined;
    current = current[token];
  }
  return current;
}

function writeJsonPointer(root: Record<string, unknown>, pointer: string, value: unknown): void {
  const tokens = decodeJsonPointer(pointer);
  if (tokens.length === 0) return;
  let current: Record<string, unknown> | unknown[] = root;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const isLeaf = index === tokens.length - 1;
    if (Array.isArray(current)) {
      const arrayIndex = readArrayIndex(token);
      if (arrayIndex === undefined) return;
      if (isLeaf) {
        current[arrayIndex] = value;
        return;
      }
      const existing: unknown = current[arrayIndex];
      if (isJsonContainer(existing)) {
        current = existing;
        continue;
      }
      const child = createJsonContainer(tokens[index + 1]);
      current[arrayIndex] = child;
      current = child;
      continue;
    }
    if (isLeaf) {
      current[token] = value;
      return;
    }
    const existing: unknown = current[token];
    if (isJsonContainer(existing)) {
      current = existing;
      continue;
    }
    const child = createJsonContainer(tokens[index + 1]);
    current[token] = child;
    current = child;
  }
}

function decodeJsonPointer(pointer: string): string[] {
  return pointer
    .slice(1)
    .split("/")
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function summarizeProjection(value: Record<string, unknown>): string | undefined {
  const leaves = collectPrimitiveLeaves(value, []).slice(0, 3);
  return leaves.length > 0 ? leaves.map(([key, entry]) => `${key}=${formatSummaryValue(entry)}`).join("  ") : undefined;
}

function summarizeEvent(kind: EventKind, value: Record<string, unknown>): string | undefined {
  switch (kind) {
    case EventKinds.ChildRunQueued:
    case EventKinds.ChildRunStarted:
    case EventKinds.ChildRunAwaitingSupervisor:
    case EventKinds.ChildRunResumed:
    case EventKinds.ChildRunSnapshotUpdated:
    case EventKinds.ChildRunDeadlineExtended:
    case EventKinds.ChildRunWrappingUp:
    case EventKinds.ChildRunCancelling:
    case EventKinds.ChildRunCompleted:
    case EventKinds.ChildRunPartialCompleted:
    case EventKinds.ChildRunInterrupted:
    case EventKinds.ChildRunTimedOut:
    case EventKinds.ChildRunFailed:
    case EventKinds.ChildRunCancelled:
      return summarizeDeclaredFields(value, [
        ["agent", "/data/agentName"],
        ["status", "/data/status"],
        ["context", "/data/contextMode"],
      ]);
    case EventKinds.ChildRunMessageCreated:
      return summarizeDeclaredFields(value, [
        ["agent", "/data/agentName"],
        ["message", "/data/messageKind"],
        ["direction", "/data/direction"],
      ]);
    case EventKinds.WorkflowStarted:
    case EventKinds.WorkflowSnapshotUpdated:
    case EventKinds.WorkflowPaused:
    case EventKinds.WorkflowCancelling:
    case EventKinds.WorkflowCompleted:
    case EventKinds.WorkflowPartialCompleted:
    case EventKinds.WorkflowFailed:
    case EventKinds.WorkflowCancelled:
      return summarizeDeclaredFields(value, [
        ["workflow", "/data/workflowId"],
        ["status", "/data/status"],
      ]);
    case EventKinds.ScheduledTaskChanged:
      return summarizeDeclaredFields(value, [
        ["task", "/data/taskId"],
        ["operation", "/data/operation"],
        ["enabled", "/data/enabled"],
      ]);
    case EventKinds.ScheduledTaskRunStarted:
    case EventKinds.ScheduledTaskRunCompleted:
    case EventKinds.ScheduledTaskRunFailed:
      return summarizeDeclaredFields(value, [
        ["task", "/data/taskId"],
        ["status", "/data/status"],
        ["run", "/data/runId"],
      ]);
    case EventKinds.SchedulerStatusSnapshot:
      return summarizeDeclaredFields(value, [
        ["active", "/data/active"],
        ["tasks", "/data/taskCount"],
        ["lease", "/data/leaseAcquired"],
      ]);
    default:
      return summarizeProjection(value);
  }
}

function summarizeDeclaredFields(
  value: Record<string, unknown>,
  fields: readonly (readonly [label: string, pointer: string])[],
): string | undefined {
  const parts = fields.flatMap(([label, pointer]) => {
    const selected = readJsonPointer(value, pointer);
    return isPrimitive(selected) ? [`${label}=${formatSummaryValue(selected)}`] : [];
  });
  return parts.length > 0 ? parts.join("  ") : undefined;
}

function collectPrimitiveLeaves(value: unknown, path: string[]): Array<[string, string | number | boolean]> {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [[path.at(-1) ?? "value", value]];
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? [[path.at(-1) ?? "items", `${value.length} items`]] : [];
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, entry]) => collectPrimitiveLeaves(entry, [...path, key]));
}

function formatSummaryValue(value: string | number | boolean): string {
  const text = String(value);
  return text.length > 44 ? `${text.slice(0, 41)}...` : text;
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJsonContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return Array.isArray(value) || isRecord(value);
}

function createJsonContainer(nextToken: string): Record<string, unknown> | unknown[] {
  return readArrayIndex(nextToken) === undefined ? {} : [];
}

function readArrayIndex(token: string): number | undefined {
  if (token === "0") return 0;
  if (!/^[1-9]\d*$/.test(token)) return undefined;
  const index = Number(token);
  return Number.isSafeInteger(index) ? index : undefined;
}
