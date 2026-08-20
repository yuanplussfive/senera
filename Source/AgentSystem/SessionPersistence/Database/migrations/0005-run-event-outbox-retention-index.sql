CREATE INDEX idx_event_outbox_committed_retention ON event_outbox(state, committed_at);
