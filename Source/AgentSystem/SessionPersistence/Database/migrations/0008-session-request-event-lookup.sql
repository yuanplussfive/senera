CREATE INDEX idx_run_events_session_request_id
  ON run_events(session_id, request_id, id);
