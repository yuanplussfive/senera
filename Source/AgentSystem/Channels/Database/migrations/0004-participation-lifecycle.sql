ALTER TABLE channel_participants RENAME TO channel_participants_v3;
DROP INDEX channel_participants_conversation_idx;
DROP INDEX channel_participants_wake_idx;
CREATE TABLE channel_participants (
  session_id TEXT PRIMARY KEY,
  conversation TEXT NOT NULL,
  source TEXT NOT NULL CHECK (json_valid(source)),
  cursor INTEGER NOT NULL DEFAULT 0 CHECK (cursor >= 0),
  trigger_sequence INTEGER NOT NULL DEFAULT 0 CHECK (trigger_sequence >= 0),
  pending_sequence INTEGER,
  resume_request_id TEXT,
  active_request_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'waiting', 'ready', 'paused')),
  wait_id TEXT,
  request_id TEXT,
  conditions TEXT CHECK (conditions IS NULL OR json_valid(conditions)),
  wake_at TEXT,
  wake_reason TEXT CHECK (wake_reason IS NULL OR wake_reason IN ('event', 'time'))
);
INSERT INTO channel_participants(session_id,conversation,source,cursor,trigger_sequence,pending_sequence,resume_request_id,
  status,wait_id,request_id,conditions,wake_at,wake_reason)
  SELECT * FROM channel_participants_v3;
DROP TABLE channel_participants_v3;
CREATE INDEX channel_participants_conversation_idx ON channel_participants(conversation);
CREATE INDEX channel_participants_wake_idx ON channel_participants(status, wake_at);

CREATE TABLE channel_event_tasks (
  sequence INTEGER NOT NULL REFERENCES channel_events(sequence) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  PRIMARY KEY(sequence, session_id)
);
CREATE INDEX channel_event_tasks_run_idx ON channel_event_tasks(session_id, request_id);
