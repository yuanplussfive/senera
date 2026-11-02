CREATE TABLE interaction_principals (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('user','agent'))
);
ALTER TABLE channel_participants ADD COLUMN actor TEXT CHECK(actor IS NULL OR json_valid(actor));
ALTER TABLE channel_participants ADD COLUMN scheduled_revision INTEGER CHECK(scheduled_revision IS NULL OR scheduled_revision > 0);
CREATE TABLE interaction_identity_bindings (
  authority TEXT NOT NULL,
  account TEXT NOT NULL,
  principal_id TEXT NOT NULL REFERENCES interaction_principals(id),
  PRIMARY KEY(authority,account)
);
CREATE TABLE interaction_legacy_subjects (
  subject_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES interaction_principals(id)
);
CREATE TABLE channel_conversation_tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES channel_participants(session_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','active','waiting','completed','cancelled')),
  owner_id TEXT NOT NULL,
  participant_ids TEXT NOT NULL,
  next_action TEXT,
  wake_at TEXT,
  created_sequence INTEGER NOT NULL REFERENCES channel_events(sequence) ON DELETE CASCADE,
  updated_sequence INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  UNIQUE(session_id,created_by)
);
CREATE INDEX channel_conversation_tasks_pending ON channel_conversation_tasks(session_id,status,created_sequence);
CREATE TABLE channel_conversation_dispositions (
  session_id TEXT NOT NULL REFERENCES channel_participants(session_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL REFERENCES channel_events(sequence) ON DELETE CASCADE,
  task_id TEXT REFERENCES channel_conversation_tasks(id) ON DELETE CASCADE,
  disposition TEXT NOT NULL CHECK(disposition IN ('request','supplement','ambient')),
  PRIMARY KEY(session_id,sequence)
);
CREATE TABLE channel_conversation_decisions (
  session_id TEXT NOT NULL REFERENCES channel_participants(session_id) ON DELETE CASCADE,
  call_id TEXT NOT NULL,
  result TEXT NOT NULL,
  PRIMARY KEY(session_id,call_id)
);
CREATE TABLE channel_task_evaluations (
  task_id TEXT NOT NULL REFERENCES channel_conversation_tasks(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  PRIMARY KEY(task_id,revision)
);
