-- Existing snapshots may contain facts and task-specific knowledge. Rebuild
-- once at the next prompt boundary using the preference-only system contract.
DELETE FROM continuity_memory_snapshot_versions;
UPDATE continuity_memory_boundaries SET generation=generation+1;
