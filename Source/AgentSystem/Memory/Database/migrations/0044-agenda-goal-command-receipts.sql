CREATE TABLE agent_agenda_command_receipts (
  command_id TEXT PRIMARY KEY,
  operation_kind TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  record_id TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL CHECK(revision > 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY(record_id) REFERENCES agent_agenda_records(id) ON DELETE CASCADE,
  FOREIGN KEY(event_id) REFERENCES agent_agenda_events(id) ON DELETE CASCADE
);

CREATE INDEX idx_agent_agenda_command_receipts_record
  ON agent_agenda_command_receipts(record_id, revision);
