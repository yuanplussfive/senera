CREATE TABLE continuity_stable_prompt_snapshots (
  session_id TEXT PRIMARY KEY,
  revision TEXT NOT NULL,
  resident_profile_json TEXT NOT NULL,
  fact_catalog_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
