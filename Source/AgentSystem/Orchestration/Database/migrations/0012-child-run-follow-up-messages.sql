CREATE TABLE child_run_messages_v12 (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE CHECK (length(trim(id)) > 0),
  child_run_id TEXT NOT NULL REFERENCES child_runs(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('child_to_parent', 'parent_to_child')),
  kind TEXT NOT NULL CHECK (kind IN ('decision', 'follow_up', 'progress', 'response', 'steering')),
  content TEXT NOT NULL CHECK (length(trim(content)) > 0),
  created_at TEXT NOT NULL
);

INSERT INTO child_run_messages_v12 (sequence, id, child_run_id, direction, kind, content, created_at)
SELECT sequence, id, child_run_id, direction, kind, content, created_at
FROM child_run_messages
ORDER BY sequence;

DROP TABLE child_run_messages;
ALTER TABLE child_run_messages_v12 RENAME TO child_run_messages;

CREATE INDEX child_run_messages_run_idx
  ON child_run_messages (child_run_id, sequence);
