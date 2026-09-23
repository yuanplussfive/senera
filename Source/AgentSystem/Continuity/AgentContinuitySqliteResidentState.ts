import type Database from "better-sqlite3";
import { AgentResidentStateSchema, type AgentResidentState } from "./AgentResidentState.js";
import { normalizeAgentContinuityScope, type AgentContinuityScopeRef } from "./AgentContinuityDomain.js";
import { createId, normalizeTimestamp } from "./AgentContinuitySqliteUtils.js";

interface ResidentStateRow {
  id: string;
  scope_kind: string;
  scope_id: string;
  bearing: string;
  mood: string;
  footing: string;
  target: string | null;
  observed_at: string;
  updated_at: string;
}

/** Reads the current resident-state row for a scope, or undefined when none exists. */
export function readAgentContinuityResidentState(
  db: Database.Database,
  scope: AgentContinuityScopeRef,
): AgentResidentState | undefined {
  const normalized = normalizeAgentContinuityScope(scope);
  const row = db
    .prepare<unknown[], ResidentStateRow>(`SELECT * FROM resident_state_records WHERE scope_kind = ? AND scope_id = ?`)
    .get(normalized.kind, normalized.id);
  if (!row) return undefined;
  return AgentResidentStateSchema.parse({
    bearing: row.bearing,
    mood: row.mood,
    footing: row.footing,
    ...(row.target ? { target: row.target } : {}),
  });
}

/** Persists the current resident-state row for a scope, creating or overwriting it. */
export function upsertAgentContinuityResidentState(
  db: Database.Database,
  scope: AgentContinuityScopeRef,
  state: AgentResidentState,
  observedAt: string,
): void {
  const normalized = normalizeAgentContinuityScope(scope);
  const observed = normalizeTimestamp(observedAt, "Resident state observation time");
  const validated = AgentResidentStateSchema.parse(state);
  const id = createId("resident_state", [normalized.kind, normalized.id]);
  db.prepare(
    `INSERT INTO resident_state_records (
       id, scope_kind, scope_id, bearing, mood, footing, target, observed_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope_kind, scope_id) DO UPDATE SET
       bearing = excluded.bearing,
       mood = excluded.mood,
       footing = excluded.footing,
       target = excluded.target,
       observed_at = excluded.observed_at,
       updated_at = excluded.updated_at`,
  ).run(
    id,
    normalized.kind,
    normalized.id,
    validated.bearing,
    validated.mood,
    validated.footing,
    validated.target ?? null,
    observed,
    observed,
  );
}

/** Drops the resident-state row for a scope; returns the number of rows removed. */
export function clearAgentContinuityResidentState(db: Database.Database, scope: AgentContinuityScopeRef): number {
  const normalized = normalizeAgentContinuityScope(scope);
  return db
    .prepare(`DELETE FROM resident_state_records WHERE scope_kind = ? AND scope_id = ?`)
    .run(normalized.kind, normalized.id).changes;
}

/** Removes resident state belonging to a session scope, e.g. during session deletion. */
export function deleteAgentContinuityResidentStateForSession(db: Database.Database, sessionId: string): number {
  return db.prepare(`DELETE FROM resident_state_records WHERE scope_kind = 'session' AND scope_id = ?`).run(sessionId)
    .changes;
}
