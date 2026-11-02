INSERT INTO run_events
  (session_id, request_id, kind, timestamp, event_sequence, step, detail_id, event_id, reliability, event_json)
SELECT event_outbox.session_id,
       event_outbox.request_id,
       event_outbox.kind,
       event_outbox.timestamp,
       event_outbox.event_sequence,
       event_outbox.step,
       event_outbox.detail_id,
       event_outbox.event_id,
       'durable',
       event_outbox.event_json
  FROM event_outbox
 WHERE NOT EXISTS (
   SELECT 1 FROM run_events
    WHERE run_events.event_id = event_outbox.event_id
 );

CREATE TABLE event_outbox_metadata (
  event_id         TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL,
  request_id       TEXT NOT NULL,
  kind             TEXT NOT NULL,
  timestamp        TEXT NOT NULL,
  event_sequence   INTEGER NOT NULL,
  step             INTEGER,
  detail_id        TEXT,
  state            TEXT NOT NULL CHECK(state IN ('pending', 'committed', 'failed')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TEXT,
  last_error       TEXT,
  created_at       TEXT NOT NULL,
  committed_at     TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES run_events(event_id) ON DELETE CASCADE
);

INSERT INTO event_outbox_metadata
  (event_id, session_id, request_id, kind, timestamp, event_sequence, step, detail_id, state,
   attempts, next_attempt_at, last_error, created_at, committed_at)
SELECT event_id, session_id, request_id, kind, timestamp, event_sequence, step, detail_id, state,
       attempts, next_attempt_at, last_error, created_at, committed_at
  FROM event_outbox;

DROP TABLE event_outbox;
ALTER TABLE event_outbox_metadata RENAME TO event_outbox;

CREATE INDEX idx_event_outbox_pending ON event_outbox(state, next_attempt_at, created_at);
CREATE INDEX idx_event_outbox_session ON event_outbox(session_id, created_at);
