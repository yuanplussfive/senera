ALTER TABLE scheduled_tasks ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'Asia/Shanghai';
ALTER TABLE scheduled_tasks ADD COLUMN target_mode TEXT NOT NULL DEFAULT 'this_session'
  CHECK (target_mode IN ('this_session', 'new_once', 'new'));
ALTER TABLE scheduled_tasks ADD COLUMN target_session_id TEXT;
