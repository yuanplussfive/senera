-- Existing boundaries keep their original background; the next boundary captures
-- the diary titles. Restart must not rewrite an in-flight system prefix.
alter table continuity_memory_snapshot_versions add column diary_index text not null default '';
