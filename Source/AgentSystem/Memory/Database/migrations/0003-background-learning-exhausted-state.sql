-- Preserve exhausted background jobs as terminal audit records instead of replaying them on startup.

drop index idx_memory_background_learning_requests_board_time;
drop index idx_memory_background_learning_requests_entity;
drop index idx_memory_background_learning_requests_status_due;

alter table memory_background_learning_requests rename to memory_background_learning_requests_legacy;

create table memory_background_learning_requests (
  request_id text primary key,
  operation_key text not null,
  board text not null,
  stage text not null,
  entity_uri text,
  source_revision text,
  attempt integer not null check ( attempt >= 1 ),
  provider_id text,
  model text,
  status text not null check ( status in ( 'started', 'completed', 'failed', 'exhausted', 'cancelled' ) ),
  started_at text not null,
  started_at_ms integer not null,
  completed_at text,
  completed_at_ms integer,
  duration_ms integer check ( duration_ms is null or duration_ms >= 0 ),
  retry_at_ms integer,
  error_code text,
  error_message text,
  usage_json text check ( usage_json is null or json_valid ( usage_json ) ),
  metadata_json text not null default '{}' check ( json_valid ( metadata_json ) )
) strict;

insert into memory_background_learning_requests (
  request_id, operation_key, board, stage, entity_uri, source_revision, attempt,
  provider_id, model, status, started_at, started_at_ms, completed_at,
  completed_at_ms, duration_ms, retry_at_ms, error_code, error_message,
  usage_json, metadata_json
)
select
  request_id, operation_key, board, stage, entity_uri, source_revision, attempt,
  provider_id, model, status, started_at, started_at_ms, completed_at,
  completed_at_ms, duration_ms, retry_at_ms, error_code, error_message,
  usage_json, metadata_json
from memory_background_learning_requests_legacy;

drop table memory_background_learning_requests_legacy;

create index idx_memory_background_learning_requests_board_time
  on memory_background_learning_requests ( board, stage, started_at_ms desc );
create index idx_memory_background_learning_requests_entity
  on memory_background_learning_requests ( entity_uri, started_at_ms desc );
create index idx_memory_background_learning_requests_status_due
  on memory_background_learning_requests ( status, retry_at_ms, started_at_ms );
