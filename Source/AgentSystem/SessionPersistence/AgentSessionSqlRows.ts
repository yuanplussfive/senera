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

export interface EntryRow {
  id: string;
  session_id: string;
  request_id: string;
  kind: string;
  timestamp: string;
  sequence: number;
  data: string;
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
