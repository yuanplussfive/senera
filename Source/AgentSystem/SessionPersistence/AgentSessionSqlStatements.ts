import type Database from "better-sqlite3";
import type {
  AppSettingRow,
  EntryRow,
  RequestIdOnlyRow,
  RequestIdRow,
  RequestSequenceRangeRow,
  RunEventRow,
  RunSnapshotPageRow,
  RunSnapshotRow,
  SessionListRow,
  SessionHistoryViewRow,
  SessionHistoryMutationRow,
  SessionForkMutationRow,
  SessionCommandRow,
  SessionRow,
  StepTraceRow,
  StepTraceRunKeyRow,
  TurnPreparationRow,
} from "./AgentSessionSqlRows.js";

export interface AgentSessionSqlStatements {
  upsertSession: Database.Statement;
  renameSession: Database.Statement;
  deleteSession: Database.Statement;
  appendEntry: Database.Statement;
  appendRunEvent: Database.Statement;
  selectSession: Database.Statement<[string], SessionRow>;
  selectSessionMetadata: Database.Statement<[], SessionRow>;
  selectSessionList: Database.Statement<[], SessionListRow>;
  selectSessionHistoryView: Database.Statement<[string], SessionHistoryViewRow>;
  selectPendingHistoryMutations: Database.Statement<[], SessionHistoryMutationRow>;
  selectPendingHistoryMutation: Database.Statement<[string], SessionHistoryMutationRow>;
  stageHistoryMutation: Database.Statement;
  deleteHistoryMutation: Database.Statement;
  selectPendingForkMutations: Database.Statement<[], SessionForkMutationRow>;
  selectPendingForkMutation: Database.Statement<[string], SessionForkMutationRow>;
  stageForkMutation: Database.Statement;
  deleteForkMutation: Database.Statement;
  selectEntries: Database.Statement<[string], EntryRow>;
  selectFirstUserEntry: Database.Statement<[string], EntryRow>;
  selectEntriesForRequests: Database.Statement<[string, number, string], EntryRow>;
  selectRequestSequenceRange: Database.Statement<[string, string], RequestSequenceRangeRow>;
  selectRequestIdsFromSequence: Database.Statement<[string, number], RequestIdRow>;
  selectEntriesThroughSequence: Database.Statement<[string, number], EntryRow>;
  selectEntryPage: Database.Statement<[string, number, number, number], EntryRow>;
  selectRunEvents: Database.Statement<[string], RunEventRow>;
  selectRunEventsForRequest: Database.Statement<[string, string], RunEventRow>;
  selectRunEventsThroughSequence: Database.Statement<[string, string, number], RunEventRow>;
  selectRunEventPage: Database.Statement<[string, number, number, number], RunEventRow>;
  selectSetting: Database.Statement<[string], AppSettingRow>;
  upsertSetting: Database.Statement;
  appendStepTrace: Database.Statement;
  selectStepTraces: Database.Statement<[string], StepTraceRow>;
  selectStepTracesThroughSequence: Database.Statement<[string, string, number], StepTraceRow>;
  selectStepTraceRunKeys: Database.Statement<[string, number, number, number, string, number], StepTraceRunKeyRow>;
  selectStepTracePage: Database.Statement<
    [string, number, number, number, string, number, number, string],
    StepTraceRow
  >;
  selectStepTraceRequestIds: Database.Statement<[string, number, string], RequestIdOnlyRow>;
  upsertRunSnapshot: Database.Statement;
  selectRunSnapshots: Database.Statement<[string], RunSnapshotRow>;
  selectRunSnapshotsForRequests: Database.Statement<[string, number, string, number], RunSnapshotRow>;
  selectRunSnapshotPage: Database.Statement<[string, number, number, number, number], RunSnapshotPageRow>;
  selectRunningRunSnapshots: Database.Statement<[], RunSnapshotRow>;
  selectRunSnapshotsThroughSequence: Database.Statement<[string, string, number], RunSnapshotRow>;
  selectSessionCommand: Database.Statement<[string, string], SessionCommandRow>;
  insertSessionCommand: Database.Statement;
  updateSessionCommandState: Database.Statement;
  deleteSessionCommandsFrom: Database.Statement;
  deleteFrom: Database.Statement;
  deleteRunEventsFrom: Database.Statement;
  deleteRunEventOutboxFrom: Database.Statement;
  deleteStepTracesFrom: Database.Statement;
  deleteRunSnapshotsFrom: Database.Statement;
  upsertTurnPreparation: Database.Statement;
  selectTurnPreparation: Database.Statement<[string, string], TurnPreparationRow>;
  selectTurnPreparationsThroughSequence: Database.Statement<[string, string, number], TurnPreparationRow>;
  deleteTurnPreparationsFrom: Database.Statement;
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
      INSERT INTO conversation_entries
        (session_id, id, request_id, kind, timestamp, sequence, data)
      VALUES (@session_id, @id, @request_id, @kind, @timestamp, @sequence, @data)
    `),
    appendRunEvent: db.prepare(`
      INSERT INTO run_events
        (session_id, request_id, kind, timestamp, event_sequence, step, detail_id, event_id, reliability, event_json)
      VALUES (@session_id, @request_id, @kind, @timestamp, @event_sequence, @step, @detail_id, @event_id, @reliability, @event_json)
      ON CONFLICT(event_id) DO NOTHING
    `),
    selectSession: db.prepare<[string], SessionRow>(`
      SELECT id, title, status, created_at, updated_at, active_request_id, metadata
      FROM sessions WHERE id = ?
    `),
    selectSessionMetadata: db.prepare<[], SessionRow>(`
      SELECT id, title, status, created_at, updated_at, active_request_id, metadata
      FROM sessions
      ORDER BY updated_at DESC
    `),
    selectSessionList: db.prepare<[], SessionListRow>(`
      SELECT
        s.id, s.title, s.status, s.created_at, s.updated_at, s.active_request_id, s.metadata,
        COUNT(e.id) AS entry_count,
        COUNT(DISTINCT CASE
          WHEN e.kind IN ('user.message', 'assistant.decision') THEN e.kind || ':' || e.request_id
        END) AS message_count
      FROM sessions s
      LEFT JOIN conversation_entries e ON e.session_id = s.id
      GROUP BY s.id
      ORDER BY s.updated_at DESC
    `),
    selectSessionHistoryView: db.prepare<[string], SessionHistoryViewRow>(`
      SELECT
        s.id, s.title, s.status, s.created_at, s.updated_at, s.active_request_id, s.metadata,
        COUNT(e.id) AS entry_count,
        COUNT(DISTINCT CASE
          WHEN e.kind IN ('user.message', 'assistant.decision') THEN e.kind || ':' || e.request_id
        END) AS message_count,
        MAX(e.sequence) AS entry_high_water_mark,
        (SELECT MAX(t.rowid) FROM step_traces t WHERE t.session_id = s.id) AS step_trace_high_water_mark,
        (SELECT MAX(r.revision_id)
         FROM run_snapshot_revisions r
         WHERE r.session_id = s.id
           AND EXISTS (SELECT 1 FROM run_snapshots current WHERE current.session_id = s.id))
          AS run_snapshot_high_water_mark,
        (SELECT MAX(r.id) FROM run_events r WHERE r.session_id = s.id) AS run_event_high_water_mark
      FROM sessions s
      LEFT JOIN conversation_entries e ON e.session_id = s.id
      WHERE s.id = ?
      GROUP BY s.id
    `),
    selectPendingHistoryMutations: db.prepare<[], SessionHistoryMutationRow>(`
      SELECT mutation_id, session_id, kind, from_request_id, pi_kind, pi_entry_id, model_provider_id, created_at
      FROM session_history_mutations
      ORDER BY created_at ASC
    `),
    selectPendingHistoryMutation: db.prepare<[string], SessionHistoryMutationRow>(`
      SELECT mutation_id, session_id, kind, from_request_id, pi_kind, pi_entry_id, model_provider_id, created_at
      FROM session_history_mutations
      WHERE session_id = ?
    `),
    stageHistoryMutation: db.prepare(`
      INSERT INTO session_history_mutations
        (mutation_id, session_id, kind, from_request_id, pi_kind, pi_entry_id, model_provider_id, created_at)
      VALUES
        (@mutation_id, @session_id, @kind, @from_request_id, @pi_kind, @pi_entry_id, @model_provider_id, @created_at)
    `),
    deleteHistoryMutation: db.prepare(`
      DELETE FROM session_history_mutations WHERE session_id = ? AND mutation_id = ?
    `),
    selectPendingForkMutations: db.prepare<[], SessionForkMutationRow>(`
      SELECT
        mutation_id, source_session_id, target_session_id, through_request_id,
        pi_kind, pi_entry_id, model_provider_id, created_at
      FROM session_fork_mutations
      ORDER BY created_at ASC
    `),
    selectPendingForkMutation: db.prepare<[string], SessionForkMutationRow>(`
      SELECT
        mutation_id, source_session_id, target_session_id, through_request_id,
        pi_kind, pi_entry_id, model_provider_id, created_at
      FROM session_fork_mutations
      WHERE target_session_id = ?
    `),
    stageForkMutation: db.prepare(`
      INSERT INTO session_fork_mutations
        (mutation_id, source_session_id, target_session_id, through_request_id,
         pi_kind, pi_entry_id, model_provider_id, created_at)
      VALUES
        (@mutation_id, @source_session_id, @target_session_id, @through_request_id,
         @pi_kind, @pi_entry_id, @model_provider_id, @created_at)
    `),
    deleteForkMutation: db.prepare(`
      DELETE FROM session_fork_mutations WHERE target_session_id = ? AND mutation_id = ?
    `),
    selectEntries: db.prepare<[string], EntryRow>(`
      SELECT id, session_id, request_id, kind, timestamp, sequence, data
      FROM conversation_entries
      WHERE session_id = ?
      ORDER BY sequence ASC
    `),
    selectFirstUserEntry: db.prepare<[string], EntryRow>(`
      SELECT id, session_id, request_id, kind, timestamp, sequence, data
      FROM conversation_entries
      WHERE session_id = ? AND kind = 'user.message'
      ORDER BY sequence ASC
      LIMIT 1
    `),
    selectEntriesForRequests: db.prepare<[string, number, string], EntryRow>(`
      SELECT id, session_id, request_id, kind, timestamp, sequence, data
      FROM conversation_entries
      WHERE session_id = ?
        AND sequence <= ?
        AND request_id IN (SELECT value FROM json_each(?) WHERE type = 'text')
      ORDER BY sequence ASC
    `),
    selectRequestSequenceRange: db.prepare<[string, string], RequestSequenceRangeRow>(`
      SELECT MIN(sequence) AS first_sequence, MAX(sequence) AS last_sequence
      FROM conversation_entries
      WHERE session_id = ? AND request_id = ?
    `),
    selectRequestIdsFromSequence: db.prepare<[string, number], RequestIdRow>(`
      SELECT request_id, MIN(sequence) AS first_sequence
      FROM conversation_entries
      WHERE session_id = ? AND sequence >= ?
      GROUP BY request_id
      ORDER BY first_sequence ASC
    `),
    selectEntriesThroughSequence: db.prepare<[string, number], EntryRow>(`
      SELECT id, session_id, request_id, kind, timestamp, sequence, data
      FROM conversation_entries
      WHERE session_id = ? AND sequence <= ?
      ORDER BY sequence ASC
    `),
    selectEntryPage: db.prepare<[string, number, number, number], EntryRow>(`
      SELECT id, session_id, request_id, kind, timestamp, sequence, data
      FROM conversation_entries
      WHERE session_id = ? AND sequence > ? AND sequence <= ?
      ORDER BY sequence ASC
      LIMIT ?
    `),
    selectRunEvents: db.prepare<[string], RunEventRow>(`
      SELECT id, session_id, request_id, kind, timestamp, event_sequence, step, detail_id, event_id, event_json
      FROM run_events
      WHERE session_id = ?
      ORDER BY id ASC
    `),
    selectRunEventsForRequest: db.prepare<[string, string], RunEventRow>(`
      SELECT id, session_id, request_id, kind, timestamp, event_sequence, step, detail_id, event_id, event_json
      FROM run_events
      WHERE session_id = ? AND request_id = ?
      ORDER BY id ASC
    `),
    selectRunEventsThroughSequence: db.prepare<[string, string, number], RunEventRow>(`
      SELECT r.id, r.session_id, r.request_id, r.kind, r.timestamp,
             r.event_sequence, r.step, r.detail_id, r.event_id, r.event_json
      FROM run_events r
      WHERE r.session_id = ?
        AND EXISTS (
          SELECT 1 FROM conversation_entries e
          WHERE e.session_id = ? AND e.request_id = r.request_id AND e.sequence <= ?
        )
      ORDER BY r.id ASC
    `),
    selectRunEventPage: db.prepare<[string, number, number, number], RunEventRow>(`
      SELECT id, session_id, request_id, kind, timestamp, event_sequence, step, detail_id, event_id, event_json
      FROM run_events
      WHERE session_id = ? AND id > ? AND id <= ?
      ORDER BY id ASC
      LIMIT ?
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
    selectStepTracesThroughSequence: db.prepare<[string, string, number], StepTraceRow>(`
      SELECT t.request_id, t.turn_sequence, t.step, t.seq, t.data
      FROM step_traces t
      WHERE t.session_id = ?
        AND EXISTS (
          SELECT 1 FROM conversation_entries e
          WHERE e.session_id = ? AND e.request_id = t.request_id AND e.sequence <= ?
        )
      ORDER BY t.turn_sequence ASC, t.step ASC, t.seq ASC
    `),
    selectStepTraceRunKeys: db.prepare<[string, number, number, number, string, number], StepTraceRunKeyRow>(`
      SELECT request_id, turn_sequence
      FROM step_traces
      WHERE session_id = ?
        AND rowid <= ?
        AND (turn_sequence > ? OR (turn_sequence = ? AND request_id > ?))
      GROUP BY turn_sequence, request_id
      ORDER BY turn_sequence ASC, request_id ASC
      LIMIT ?
    `),
    selectStepTracePage: db.prepare<[string, number, number, number, string, number, number, string], StepTraceRow>(`
      SELECT request_id, turn_sequence, step, seq, data
      FROM step_traces
      WHERE session_id = ?
        AND rowid <= ?
        AND (turn_sequence > ? OR (turn_sequence = ? AND request_id > ?))
        AND (turn_sequence < ? OR (turn_sequence = ? AND request_id <= ?))
      ORDER BY turn_sequence ASC, request_id ASC, step ASC, seq ASC
    `),
    selectStepTraceRequestIds: db.prepare<[string, number, string], RequestIdOnlyRow>(`
      SELECT DISTINCT request_id
      FROM step_traces
      WHERE session_id = ?
        AND rowid <= ?
        AND request_id IN (SELECT value FROM json_each(?) WHERE type = 'text')
    `),
    upsertRunSnapshot: db.prepare(`
      INSERT INTO run_snapshots
        (session_id, request_id, input, status, started_at, updated_at, ended_at, error_message, model_provider,
         history_sequence)
      VALUES
        (@session_id, @request_id, @input, @status, @started_at, @updated_at, @ended_at, @error_message,
         @model_provider, COALESCE((
           SELECT MAX(history_sequence) + 1 FROM run_snapshot_revisions WHERE session_id = @session_id
         ), 0))
      ON CONFLICT(session_id, request_id) DO UPDATE SET
        input          = excluded.input,
        status         = excluded.status,
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
      ORDER BY history_sequence ASC
    `),
    selectRunSnapshotsForRequests: db.prepare<[string, number, string, number], RunSnapshotRow>(`
      SELECT
        r.session_id, r.request_id, r.input, r.status, r.started_at, r.updated_at,
        r.ended_at, r.error_message, r.model_provider
      FROM run_snapshot_revisions r
      WHERE r.session_id = ?
        AND r.revision_id <= ?
        AND r.deleted = 0
        AND r.request_id IN (SELECT value FROM json_each(?) WHERE type = 'text')
        AND r.revision_id = (
          SELECT MAX(latest.revision_id)
          FROM run_snapshot_revisions latest
          WHERE latest.session_id = r.session_id
            AND latest.request_id = r.request_id
            AND latest.revision_id <= ?
        )
      ORDER BY r.history_sequence ASC
    `),
    selectRunSnapshotPage: db.prepare<[string, number, number, number, number], RunSnapshotPageRow>(`
      SELECT
        r.session_id, r.request_id, r.input, r.status, r.started_at, r.updated_at,
        r.ended_at, r.error_message, r.model_provider, r.history_sequence
      FROM run_snapshot_revisions r
      WHERE r.session_id = ?
        AND r.history_sequence > ?
        AND r.revision_id <= ?
        AND r.deleted = 0
        AND r.revision_id = (
          SELECT MAX(latest.revision_id)
          FROM run_snapshot_revisions latest
          WHERE latest.session_id = r.session_id
            AND latest.request_id = r.request_id
            AND latest.revision_id <= ?
        )
      ORDER BY r.history_sequence ASC
      LIMIT ?
    `),
    selectRunningRunSnapshots: db.prepare<[], RunSnapshotRow>(`
      SELECT
        session_id, request_id, input, status, started_at, updated_at,
        ended_at, error_message, model_provider
      FROM run_snapshots
      WHERE status = 'running'
      ORDER BY session_id ASC, history_sequence ASC
    `),
    selectRunSnapshotsThroughSequence: db.prepare<[string, string, number], RunSnapshotRow>(`
      SELECT
        r.session_id, r.request_id, r.input, r.status, r.started_at, r.updated_at,
        r.ended_at, r.error_message, r.model_provider
      FROM run_snapshots r
      WHERE r.session_id = ?
        AND EXISTS (
          SELECT 1 FROM conversation_entries e
          WHERE e.session_id = ? AND e.request_id = r.request_id AND e.sequence <= ?
        )
      ORDER BY r.history_sequence ASC
    `),
    selectSessionCommand: db.prepare<[string, string], SessionCommandRow>(`
      SELECT
        session_id, command_id, operation_kind, payload_hash, request_id,
        state, created_at, updated_at
      FROM session_commands
      WHERE session_id = ? AND command_id = ?
    `),
    insertSessionCommand: db.prepare(`
      INSERT INTO session_commands
        (session_id, command_id, operation_kind, payload_hash, request_id, state, created_at, updated_at)
      VALUES
        (@session_id, @command_id, @operation_kind, @payload_hash, @request_id, 'running', @created_at, @updated_at)
    `),
    updateSessionCommandState: db.prepare(`
      UPDATE session_commands
      SET state = @state, updated_at = @updated_at
      WHERE session_id = @session_id AND command_id = @command_id AND request_id = @request_id
    `),
    deleteSessionCommandsFrom: db.prepare(`
      DELETE FROM session_commands
      WHERE session_id = ?
        AND request_id IN (
          SELECT request_id FROM conversation_entries
          WHERE session_id = ?
            AND sequence >= (
              SELECT MIN(sequence) FROM conversation_entries
              WHERE session_id = ? AND request_id = ?
            )
        )
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
          history_sequence >= (
            SELECT history_sequence FROM run_snapshots
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
    upsertTurnPreparation: db.prepare(`
      INSERT INTO turn_preparations (session_id, request_id, snapshot_json, created_at)
      VALUES (@session_id, @request_id, @snapshot_json, @created_at)
      ON CONFLICT(session_id, request_id) DO UPDATE SET
        snapshot_json = excluded.snapshot_json,
        created_at = excluded.created_at
    `),
    selectTurnPreparation: db.prepare<[string, string], TurnPreparationRow>(`
      SELECT session_id, request_id, snapshot_json, created_at
      FROM turn_preparations
      WHERE session_id = ? AND request_id = ?
    `),
    selectTurnPreparationsThroughSequence: db.prepare<[string, string, number], TurnPreparationRow>(`
      SELECT p.session_id, p.request_id, p.snapshot_json, p.created_at
      FROM turn_preparations p
      WHERE p.session_id = ?
        AND EXISTS (
          SELECT 1 FROM conversation_entries e
          WHERE e.session_id = ? AND e.request_id = p.request_id AND e.sequence <= ?
        )
      ORDER BY p.created_at ASC, p.request_id ASC
    `),
    deleteTurnPreparationsFrom: db.prepare(`
      DELETE FROM turn_preparations
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
    deleteRunEventOutboxFrom: db.prepare(`
      DELETE FROM event_outbox
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
