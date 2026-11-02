-- A session snapshot is the complete automatic-memory selection. The former
-- per-turn delivery ledger cannot influence selection and is retired.

drop index idx_continuity_memory_delivery_session;
drop table continuity_memory_delivery;
