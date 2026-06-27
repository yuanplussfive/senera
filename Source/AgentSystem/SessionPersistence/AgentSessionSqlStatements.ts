import type Database from "better-sqlite3";
import type {
  AppSettingRow,
  EntryRow,
  RunEventRow,
  RunSnapshotRow,
  SessionListRow,
  SessionRow,
  StepTraceRow,
} from "./AgentSessionSqlRows.js";

export interface AgentSessionSqlStatements {
  upsertSession: Database.Statement;
  renameSession: Database.Statement;
  deleteSession: Database.Statement;
  appendEntry: Database.Statement;
  appendRunEvent: Database.Statement;
  selectSession: Database.Statement<[string], SessionRow>;
  selectAllSessions: Database.Statement<[], SessionRow>;
  selectSessionList: Database.Statement<[], SessionListRow>;
  selectEntries: Database.Statement<[string], EntryRow>;
  selectRunEvents: Database.Statement<[string], RunEventRow>;
  selectSetting: Database.Statement<[string], AppSettingRow>;
  upsertSetting: Database.Statement;
  appendStepTrace: Database.Statement;
  selectStepTraces: Database.Statement<[string], StepTraceRow>;
  upsertRunSnapshot: Database.Statement;
  selectRunSnapshots: Database.Statement<[string], RunSnapshotRow>;
  deleteFrom: Database.Statement;
  deleteRunEventsFrom: Database.Statement;
  deleteStepTracesFrom: Database.Statement;
  deleteRunSnapshotsFrom: Database.Statement;
}

export function prepareAgentSessionSqlStatements(db: Database.Database): AgentSessionSqlStatements {
  return {
    upsertSession: db.prepare(`
      INSERT INTO sessions (id, title, status, created_at, updated_at, active_request_id, metadata)
      VALUES (@id, @title, @status, @created_at, @updated_at, @active_request_id, @metadata)
      ON CONFLICT(id) DO UPDATE SET
        title             = excluded.title,
        status            = excluded.status,
        updated_at        = excluded.updated_at,
        active_request_id = excluded.active_request_id,
        metadata          = excluded.metadata
    `),
    renameSession: db.prepare(`
      UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?
    `),
    deleteSession: db.prepare(`DELETE FROM sessions WHERE id = ?`),
    appendEntry: db.prepare(`
      INSERT OR IGNORE INTO conversation_entries
        (id, session_id, request_id, kind, timestamp, sequence, data)
      VALUES (@id, @session_id, @request_id, @kind, @timestamp, @sequence, @data)
    `),
    appendRunEvent: db.prepare(`
      INSERT INTO run_events
        (session_id, request_id, kind, timestamp, event_sequence, step, detail_id, event_json)
      VALUES (@session_id, @request_id, @kind, @timestamp, @event_sequence, @step, @detail_id, @event_json)
    `),
    selectSession: db.prepare<[string], SessionRow>(`
      SELECT id, title, status, created_at, updated_at, active_request_id, metadata
      FROM sessions WHERE id = ?
    `),
    selectAllSessions: db.prepare<[], SessionRow>(`
      SELECT id, title, status, created_at, updated_at, active_request_id, metadata
      FROM sessions ORDER BY updated_at DESC
    `),
    selectSessionList: db.prepare<[], SessionListRow>(`
      SELECT
        s.id, s.title, s.status, s.created_at, s.updated_at, s.active_request_id, s.metadata,
        COUNT(e.id) AS entry_count,
        COALESCE(SUM(CASE WHEN e.kind IN ('user.message', 'assistant.decision') THEN 1 ELSE 0 END), 0) AS message_count
      FROM sessions s
      LEFT JOIN conversation_entries e ON e.session_id = s.id
      GROUP BY s.id
      ORDER BY s.updated_at DESC
    `),
    selectEntries: db.prepare<[string], EntryRow>(`
      SELECT id, session_id, request_id, kind, timestamp, sequence, data
      FROM conversation_entries
      WHERE session_id = ?
      ORDER BY sequence ASC
    `),
    selectRunEvents: db.prepare<[string], RunEventRow>(`
      SELECT id, session_id, request_id, kind, timestamp, event_sequence, step, detail_id, event_json
      FROM run_events
      WHERE session_id = ?
      ORDER BY id ASC
    `),
    selectSetting: db.prepare<[string], AppSettingRow>(`
      SELECT key, value, updated_at
      FROM app_settings
      WHERE key = ?
    `),
    upsertSetting: db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (@key, @value, @updated_at)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `),
    appendStepTrace: db.prepare(`
      INSERT OR IGNORE INTO step_traces
        (session_id, request_id, turn_sequence, step, seq, data)
      VALUES (@session_id, @request_id, @turn_sequence, @step, @seq, @data)
    `),
    selectStepTraces: db.prepare<[string], StepTraceRow>(`
      SELECT request_id, turn_sequence, step, seq, data
      FROM step_traces
      WHERE session_id = ?
      ORDER BY turn_sequence ASC, step ASC, seq ASC
    `),
    upsertRunSnapshot: db.prepare(`
      INSERT INTO run_snapshots
        (session_id, request_id, input, status, started_at, updated_at, ended_at, error_message, model_provider)
      VALUES
        (@session_id, @request_id, @input, @status, @started_at, @updated_at, @ended_at, @error_message, @model_provider)
      ON CONFLICT(session_id, request_id) DO UPDATE SET
        input          = excluded.input,
        status         = excluded.status,
        started_at     = excluded.started_at,
        updated_at     = excluded.updated_at,
        ended_at       = excluded.ended_at,
        error_message  = excluded.error_message,
        model_provider = excluded.model_provider
    `),
    selectRunSnapshots: db.prepare<[string], RunSnapshotRow>(`
      SELECT
        session_id, request_id, input, status, started_at, updated_at,
        ended_at, error_message, model_provider
      FROM run_snapshots
      WHERE session_id = ?
      ORDER BY started_at ASC
    `),
    deleteStepTracesFrom: db.prepare(`
      DELETE FROM step_traces
      WHERE session_id = ?
        AND turn_sequence >= (
          SELECT MIN(sequence) FROM conversation_entries
          WHERE session_id = ? AND request_id = ?
        )
    `),
    deleteRunSnapshotsFrom: db.prepare(`
      DELETE FROM run_snapshots
      WHERE session_id = ?
        AND (
          started_at >= (
            SELECT started_at FROM run_snapshots
            WHERE session_id = ? AND request_id = ?
          )
          OR request_id IN (
            SELECT request_id FROM conversation_entries
            WHERE session_id = ?
              AND sequence >= (
                SELECT MIN(sequence) FROM conversation_entries
                WHERE session_id = ? AND request_id = ?
              )
          )
        )
    `),
    deleteFrom: db.prepare(`
      DELETE FROM conversation_entries
      WHERE session_id = ?
        AND sequence >= (
          SELECT MIN(sequence) FROM conversation_entries
          WHERE session_id = ? AND request_id = ?
        )
    `),
    deleteRunEventsFrom: db.prepare(`
      DELETE FROM run_events
      WHERE session_id = ?
        AND request_id IN (
          SELECT DISTINCT request_id FROM conversation_entries
          WHERE session_id = ?
            AND sequence >= (
              SELECT MIN(sequence) FROM conversation_entries
              WHERE session_id = ? AND request_id = ?
            )
        )
    `),
  };
}
