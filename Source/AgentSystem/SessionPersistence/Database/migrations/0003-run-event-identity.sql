ALTER TABLE run_events ADD COLUMN event_id TEXT;
ALTER TABLE run_events ADD COLUMN reliability TEXT NOT NULL DEFAULT 'durable';
UPDATE run_events SET event_id = 'legacy:' || CAST(id AS TEXT) WHERE event_id IS NULL;
CREATE UNIQUE INDEX idx_run_events_event_id ON run_events(event_id);
