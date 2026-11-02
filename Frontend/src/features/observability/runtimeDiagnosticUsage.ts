import { EventKinds } from "../../api/generatedEventCatalog";
import type { SessionRuntimeSnapshot } from "../../store/sessionStore";
import type { EventJournalRecord } from "./eventJournalStore";
import { readJsonPointer } from "./eventJournalProjection";
import type { RuntimeContextUsage, RuntimeSessionUsage, RuntimeUsageSnapshot } from "./runtimeDiagnosticTypes";

export function projectRuntimeUsageFromSessionSnapshot(
  snapshot: SessionRuntimeSnapshot | undefined,
): RuntimeUsageSnapshot {
  const runtime = snapshot?.runtime;
  if (!runtime) return {};

  return {
    contextUsage: readContextUsageValue(runtime.contextUsage),
    sessionUsage: readSessionUsageValue(runtime.stats),
  };
}

export function mergeRuntimeUsageSnapshots(
  current: RuntimeUsageSnapshot,
  retained: RuntimeUsageSnapshot,
): RuntimeUsageSnapshot {
  const currentContext = current.contextUsage;
  const retainedContext = retained.contextUsage;
  const contextUsage =
    retainedContext &&
    (!currentContext ||
      (currentContext.tokens === null &&
        currentContext.percent === null &&
        currentContext.contextWindow === retainedContext.contextWindow))
      ? retainedContext
      : currentContext;
  const sessionUsage = current.sessionUsage ?? retained.sessionUsage;

  return {
    ...(contextUsage ? { contextUsage } : {}),
    ...(sessionUsage ? { sessionUsage } : {}),
  };
}

export function readLatestSessionUsage(records: readonly EventJournalRecord[]): RuntimeSessionUsage | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record.kind !== EventKinds.SessionRuntimeStatus) continue;
    const usage = readSessionUsageValue(readJsonPointer(record.projection, "/data/runtime/stats"));
    if (usage) return usage;
  }
  return undefined;
}

export function readLatestContextUsage(records: readonly EventJournalRecord[]): RuntimeContextUsage | undefined {
  let unknown: RuntimeContextUsage | undefined;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record.kind !== EventKinds.SessionRuntimeStatus) continue;
    const value = readContextUsageValue(readJsonPointer(record.projection, "/data/runtime/contextUsage"));
    if (!value) continue;
    if (value.tokens !== null || value.percent !== null) {
      if (!unknown || unknown.contextWindow === value.contextWindow) return value;
      return unknown;
    }
    unknown ??= value;
  }
  return unknown;
}

function readContextUsageValue(value: unknown): RuntimeContextUsage | undefined {
  if (!isRecord(value)) return undefined;
  const contextWindow = readFiniteNumber(value.contextWindow);
  if (contextWindow === undefined || contextWindow <= 0) return undefined;
  return {
    tokens: readNullableFiniteNumber(value.tokens),
    contextWindow,
    percent: readNullableFiniteNumber(value.percent),
  };
}

function readSessionUsageValue(value: unknown): RuntimeSessionUsage | undefined {
  if (!isRecord(value) || !isRecord(value.tokens)) return undefined;
  const tokens = value.tokens;
  return {
    userMessages: readNonNegativeNumber(value.userMessages),
    assistantMessages: readNonNegativeNumber(value.assistantMessages),
    toolCalls: readNonNegativeNumber(value.toolCalls),
    toolResults: readNonNegativeNumber(value.toolResults),
    totalMessages: readNonNegativeNumber(value.totalMessages),
    tokens: {
      input: readNonNegativeNumber(tokens.input),
      output: readNonNegativeNumber(tokens.output),
      cacheRead: readNonNegativeNumber(tokens.cacheRead),
      cacheWrite: readNonNegativeNumber(tokens.cacheWrite),
      total: readNonNegativeNumber(tokens.total),
    },
    cost: typeof value.cost === "number" && Number.isFinite(value.cost) && value.cost >= 0 ? value.cost : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNullableFiniteNumber(value: unknown): number | null {
  return value === null ? null : (readFiniteNumber(value) ?? null);
}

function readNonNegativeNumber(value: unknown): number {
  const number = readFiniteNumber(value);
  return number === undefined ? 0 : Math.max(0, number);
}
