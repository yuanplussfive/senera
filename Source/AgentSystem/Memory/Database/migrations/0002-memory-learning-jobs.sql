CREATE TABLE memory_learning_jobs (
  episode_uri TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'retry', 'completed', 'failed')),
  attempts INTEGER NOT NULL,
  next_attempt_at_ms INTEGER NOT NULL,
  last_error TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (episode_uri) REFERENCES memory_episodes(uri) ON DELETE CASCADE
);
CREATE INDEX idx_memory_learning_jobs_due ON memory_learning_jobs(status, next_attempt_at_ms, updated_at_ms);
