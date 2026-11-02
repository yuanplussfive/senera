CREATE TABLE channel_agent_sessions (
  platform TEXT NOT NULL CHECK (length(trim(platform)) > 0),
  chat_type TEXT NOT NULL CHECK (length(trim(chat_type)) > 0),
  chat_id TEXT NOT NULL CHECK (length(trim(chat_id)) > 0),
  user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL DEFAULT '',
  thread_id TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL CHECK (length(trim(session_id)) > 0),
  epoch INTEGER NOT NULL DEFAULT 1 CHECK (epoch >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (platform, chat_type, chat_id, user_id, agent_id, thread_id)
);
INSERT INTO channel_agent_sessions(platform,chat_type,chat_id,user_id,agent_id,thread_id,session_id,epoch,created_at,updated_at)
  SELECT platform,chat_type,chat_id,user_id,'',coalesce(thread_id,''),session_id,epoch,created_at,updated_at FROM channel_sessions;
DROP TABLE channel_sessions;
ALTER TABLE channel_agent_sessions RENAME TO channel_sessions;
CREATE INDEX channel_sessions_session_idx ON channel_sessions(session_id);
CREATE INDEX channel_sessions_updated_idx ON channel_sessions(updated_at);
