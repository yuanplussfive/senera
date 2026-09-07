CREATE INDEX idx_continuity_fact_history_observation
  ON continuity_fact_history(observation_uri);

CREATE INDEX idx_continuity_fact_heads_observation_status
  ON continuity_fact_heads(observation_uri, status);
