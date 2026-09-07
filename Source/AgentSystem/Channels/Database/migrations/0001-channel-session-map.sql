CREATE TABLE channel_sessions (
  platform TEXT NOT NULL CHECK (length(trim(platform)) > 0),
  chat_type TEXT NOT NULL CHECK (length(trim(chat_type)) > 0),
  chat_id TEXT NOT NULL CHECK (length(trim(chat_id)) > 0),
  user_id TEXT NOT NULL,
  thread_id TEXT,
  session_id TEXT NOT NULL CHECK (length(trim(session_id)) > 0),
  epoch INTEGER NOT NULL DEFAULT 1 CHECK (epoch >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (platform, chat_type, chat_id, user_id, thread_id)
);

CREATE INDEX channel_sessions_session_idx
  ON channel_sessions (session_id);

CREATE INDEX channel_sessions_updated_idx
  ON channel_sessions (updated_at);