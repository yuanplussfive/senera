import type { AgentModelProviderMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
import type { StoredRunSnapshot, StoredRunSnapshotStatus } from "../Session/AgentSqliteSessionRepository.js";
import type { RunSnapshotRow } from "./AgentSessionSqlRows.js";

export interface EncodedRunSnapshotRow {
  session_id: string;
  request_id: string;
  input: string;
  status: StoredRunSnapshotStatus;
  started_at: string;
  updated_at: string;
  ended_at: string | null;
  error_message: string | null;
  model_provider: string | null;
}

export function runSnapshotToRow(snapshot: StoredRunSnapshot): EncodedRunSnapshotRow {
  return {
    session_id: snapshot.sessionId,
    request_id: snapshot.requestId,
    input: snapshot.input,
    status: snapshot.status,
    started_at: snapshot.startedAt,
    updated_at: snapshot.updatedAt,
    ended_at: snapshot.endedAt ?? null,
    error_message: snapshot.errorMessage ?? null,
    model_provider: snapshot.modelProvider ? JSON.stringify(snapshot.modelProvider) : null,
  };
}

export function rowToRunSnapshot(row: RunSnapshotRow): StoredRunSnapshot {
  return {
    sessionId: row.session_id,
    requestId: row.request_id,
    input: row.input,
    status: parseRunSnapshotStatus(row.status),
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at ?? undefined,
    errorMessage: row.error_message ?? undefined,
    modelProvider: parseModelProviderMetadata(row.model_provider),
  };
}

function parseRunSnapshotStatus(raw: string): StoredRunSnapshotStatus {
  if (raw === "running" || raw === "completed" || raw === "failed" || raw === "cancelled") {
    return raw;
  }
  return "failed";
}

function parseModelProviderMetadata(value: string | null): AgentModelProviderMetadata | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as AgentModelProviderMetadata)
      : undefined;
  } catch {
    return undefined;
  }
}
