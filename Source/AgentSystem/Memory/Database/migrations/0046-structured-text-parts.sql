ALTER TABLE agent_world_events
  ADD COLUMN summary_parts_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE memory_temporal_digests
  ADD COLUMN summary_parts_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE memory_temporal_digests
  ADD COLUMN topics_parts_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE memory_temporal_digests
  ADD COLUMN open_loops_parts_json TEXT NOT NULL DEFAULT '[]';
