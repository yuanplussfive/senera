CREATE TABLE session_inputs (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  parent_request_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','delivered','completed','failed','cancelled')),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  UNIQUE(session_id,request_id)
);
CREATE INDEX idx_session_inputs_state ON session_inputs(state,session_id,sequence);
CREATE TRIGGER trg_session_inputs_history_delete AFTER DELETE ON conversation_entries
BEGIN
  DELETE FROM session_inputs WHERE session_id=OLD.session_id AND
    (request_id=OLD.request_id OR parent_request_id=OLD.request_id);
END;
