CREATE TABLE channel_ingress (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','accepted','failed','discarded')),
  payload TEXT NOT NULL CHECK(json_valid(payload))
);
CREATE INDEX idx_channel_ingress_pending ON channel_ingress(platform,state,sequence);
