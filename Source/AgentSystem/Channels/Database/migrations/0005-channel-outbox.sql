CREATE TABLE channel_outbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL,
  lane TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','sending','sent','failed','uncertain')),
  digest TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload))
);
CREATE INDEX idx_channel_outbox_pending ON channel_outbox(platform,state,sequence);
