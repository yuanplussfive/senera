-- Learning provenance is direct and queryable. Snapshot references freeze the
-- automatic system-memory selection for a session without storing semantic data twice.

alter table memory_background_learning_requests add column session_id text;

create index idx_memory_background_learning_requests_session_time
  on memory_background_learning_requests ( session_id, started_at_ms desc );

create table continuity_memory_snapshots (
  session_id text primary key check ( length( trim( session_id ) ) > 0 ),
  entries_json text not null check ( json_valid( entries_json ) ),
  created_at text not null,
  updated_at text not null
) strict;
