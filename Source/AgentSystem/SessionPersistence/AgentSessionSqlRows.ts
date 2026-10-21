import type { StoredRunSnapshotStatus } from "../Session/AgentSqliteSessionRepository.js";

export interface SessionRow {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  active_request_id: string | null;
  metadata: string;
}

export interface SessionListRow extends SessionRow {
  entry_count: number;
  message_count: number;
}

export interface SessionHistoryViewRow extends SessionListRow {
  entry_high_water_mark: number | null;
  step_trace_high_water_mark: number | null;
  run_snapshot_high_water_mark: number | null;
  run_event_high_water_mark: number | null;
}

export interface SessionHistoryMutationRow {
  mutation_id: string;
  session_id: string;
  kind: string;
  from_request_id: string;
  pi_kind: string;
  pi_entry_id: string | null;
  model_provider_id: string | null;
  created_at: string;
}

export interface SessionForkMutationRow {
  mutation_id: string;
  source_session_id: string;
  target_session_id: string;
  through_request_id: string;
  pi_kind: string;
  pi_entry_id: string | null;
  model_provider_id: string | null;
  created_at: string;
}

export interface EntryRow {
  id: string;
  session_id: string;
  request_id: string;
  kind: string;
  timestamp: string;
  sequence: number;
  data: string;
}

export interface RequestSequenceRangeRow {
  first_sequence: number | null;
  last_sequence: number | null;
}

export interface RequestIdRow {
  request_id: string;
  first_sequence: number;
}

export interface RequestIdOnlyRow {
  request_id: string;
}

export interface RunEventRow {
  id: number;
  session_id: string;
  request_id: string;
  kind: string;
  timestamp: string;
  event_sequence: number;
  step: number | null;
  detail_id: string | null;
  event_id: string;
  event_json: string;
}

export interface AppSettingRow {
  key: string;
  value: string;
  updated_at: string;
}

export interface StepTraceRow {
  request_id: string;
  turn_sequence: number;
  step: number;
  seq: number;
  data: string;
}

export interface StepTraceRunKeyRow {
  request_id: string;
  turn_sequence: number;
}

export interface RunSnapshotRow {
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

export interface RunSnapshotPageRow extends RunSnapshotRow {
  history_sequence: number;
}

export interface SessionCommandRow {
  session_id: string;
  command_id: string;
  operation_kind: string;
  payload_hash: string;
  request_id: string;
  state: "running" | "completed" | "failed" | "cancelled";
  created_at: string;
  updated_at: string;
}

export interface TurnPreparationRow {
  session_id: string;
  request_id: string;
  snapshot_json: string;
  created_at: string;
}
