CREATE TABLE channel_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation TEXT NOT NULL,
  event_key TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  UNIQUE (conversation, event_key)
);
CREATE INDEX channel_events_conversation_idx ON channel_events(conversation, sequence);

CREATE TABLE channel_participants (
  session_id TEXT PRIMARY KEY,
  conversation TEXT NOT NULL,
  source TEXT NOT NULL CHECK (json_valid(source)),
  cursor INTEGER NOT NULL DEFAULT 0 CHECK (cursor >= 0),
  trigger_sequence INTEGER NOT NULL DEFAULT 0 CHECK (trigger_sequence >= 0),
  pending_sequence INTEGER,
  resume_request_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'waiting', 'ready')),
  wait_id TEXT,
  request_id TEXT,
  conditions TEXT CHECK (conditions IS NULL OR json_valid(conditions)),
  wake_at TEXT,
  wake_reason TEXT CHECK (wake_reason IS NULL OR wake_reason IN ('event', 'time'))
);
CREATE INDEX channel_participants_conversation_idx ON channel_participants(conversation);
CREATE INDEX channel_participants_wake_idx ON channel_participants(status, wake_at);
