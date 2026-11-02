-- table: agent_execution_events
create table agent_execution_events ( id text primary key , execution_id text not null , event_kind text not null , step_id text , session_id text not null , request_id text not null , payload_json text not null , occurred_at text not null , foreign key ( execution_id ) references agent_execution_runs ( id ) on delete cascade , foreign key ( step_id ) references agent_execution_steps ( id ) on delete set null );

-- table: agent_execution_runs
create table agent_execution_runs ( id text primary key , uri text not null unique , session_id text not null , request_id text not null , objective text not null , status text not null check ( status in ( 'active' , 'paused' , 'blocked' , 'completed' , 'cancelled' ) ) , reason text , created_at text not null , updated_at text not null , completed_at text , unique ( session_id , request_id ) );

-- table: agent_execution_steps
create table agent_execution_steps ( id text primary key , execution_id text not null , node_id text not null , plan_id text not null , plan_revision integer not null , step_index integer not null , title text not null , detail text not null , status text not null check ( status in ( 'planned' , 'running' , 'completed' , 'failed' , 'blocked' ) ) , dependency_ids_json text not null , call_id text , failure text , created_at text not null , updated_at text not null , unique ( execution_id , node_id ) , foreign key ( execution_id ) references agent_execution_runs ( id ) on delete cascade );

-- table: agent_todos
create table agent_todos ( id text not null , session_id text not null , item_order integer not null , content text not null , status text not null check ( status in ( 'pending' , 'in_progress' , 'completed' , 'cancelled' ) ) , created_at text not null , updated_at text not null , primary key ( session_id , id ) );

-- table: continuity_memory_delivery
create table continuity_memory_delivery ( session_id text not null check ( length ( trim ( session_id ) ) > 0 ) , context_epoch text not null check ( length ( trim ( context_epoch ) ) > 0 ) , memory_key text not null check ( length ( trim ( memory_key ) ) > 0 ) , delivered_at text not null , primary key ( session_id , context_epoch , memory_key ) ) strict;

-- table: memory_background_learning_requests
create table "memory_background_learning_requests" ( request_id text primary key , operation_key text not null , board text not null , stage text not null , entity_uri text , source_revision text , attempt integer not null check ( attempt >= 1 ) , provider_id text , model text , status text not null check ( status in ( 'started' , 'completed' , 'failed' , 'cancelled' ) ) , started_at text not null , started_at_ms integer not null , completed_at text , completed_at_ms integer , duration_ms integer check ( duration_ms is null or duration_ms >= 0 ) , retry_at_ms integer , error_code text , error_message text , usage_json text check ( usage_json is null or json_valid ( usage_json ) ) , metadata_json text not null default '{}' check ( json_valid ( metadata_json ) ) ) strict;

-- table: memory_catalog_state
create table memory_catalog_state ( catalog text primary key , revision integer not null check ( revision >= 0 ) );

-- table: memory_episodes
create table memory_episodes ( id text primary key , uri text not null unique , session_id text not null , request_id text not null , status text not null , raw_user_text text not null , standalone_request text not null , context_basis text not null , topic text not null , assistant_text text not null , started_at text not null , completed_at text not null , updated_at text not null , started_at_ms integer not null , completed_at_ms integer not null , updated_at_ms integer not null , time_zone text not null , local_date text not null , local_hour text not null , metadata_json text not null , unique ( session_id , request_id ) );

-- table: memory_sources
create table memory_sources ( id text primary key , uri text not null unique , episode_id text not null , episode_uri text not null , session_id text not null , request_id text not null , source_kind text not null , role text not null , text_content text , summary text , conversation_entry_id text not null , evidence_uri text not null , artifact_uri text not null , tool_name text not null , created_at text not null , updated_at text not null , created_at_ms integer not null , updated_at_ms integer not null , time_zone text not null , local_date text not null , local_hour text not null , metadata_json text not null , foreign key ( episode_id ) references memory_episodes ( id ) on delete cascade );

-- table: pi_compaction_candidates
create table pi_compaction_candidates ( candidate_id text primary key , session_id text not null , branch_epoch text , snapshot_leaf_id text not null , created_at text not null , candidate_json text not null );

-- trigger: memory_episodes_catalog_revision_delete
create trigger memory_episodes_catalog_revision_delete after delete on memory_episodes begin update memory_catalog_state set revision = revision + 1 where catalog = 'physical_history' ; end;

-- trigger: memory_episodes_catalog_revision_insert
create trigger memory_episodes_catalog_revision_insert after insert on memory_episodes begin update memory_catalog_state set revision = revision + 1 where catalog = 'physical_history' ; end;

-- trigger: memory_episodes_catalog_revision_update
create trigger memory_episodes_catalog_revision_update after update on memory_episodes begin update memory_catalog_state set revision = revision + 1 where catalog = 'physical_history' ; end;

-- trigger: memory_sources_catalog_revision_delete
create trigger memory_sources_catalog_revision_delete after delete on memory_sources begin update memory_catalog_state set revision = revision + 1 where catalog = 'physical_history' ; end;

-- trigger: memory_sources_catalog_revision_insert
create trigger memory_sources_catalog_revision_insert after insert on memory_sources begin update memory_catalog_state set revision = revision + 1 where catalog = 'physical_history' ; end;

-- trigger: memory_sources_catalog_revision_update
create trigger memory_sources_catalog_revision_update after update on memory_sources begin update memory_catalog_state set revision = revision + 1 where catalog = 'physical_history' ; end;

-- index: idx_agent_execution_events_execution_time
create index idx_agent_execution_events_execution_time on agent_execution_events ( execution_id , occurred_at );

-- index: idx_agent_execution_runs_session_status
create index idx_agent_execution_runs_session_status on agent_execution_runs ( session_id , status , updated_at );

-- index: idx_agent_execution_steps_execution_status
create index idx_agent_execution_steps_execution_status on agent_execution_steps ( execution_id , status , step_index );

-- index: idx_agent_todos_session_order
create index idx_agent_todos_session_order on agent_todos ( session_id , item_order , id );

-- index: idx_continuity_memory_delivery_session
create index idx_continuity_memory_delivery_session on continuity_memory_delivery ( session_id , context_epoch , delivered_at );

-- index: idx_memory_background_learning_requests_board_time
create index idx_memory_background_learning_requests_board_time on memory_background_learning_requests ( board , stage , started_at_ms desc );

-- index: idx_memory_background_learning_requests_entity
create index idx_memory_background_learning_requests_entity on memory_background_learning_requests ( entity_uri , started_at_ms desc );

-- index: idx_memory_background_learning_requests_status_due
create index idx_memory_background_learning_requests_status_due on memory_background_learning_requests ( status , retry_at_ms , started_at_ms );

-- index: idx_memory_episodes_completed_range
create index idx_memory_episodes_completed_range on memory_episodes ( completed_at_ms , session_id , id );

-- index: idx_memory_episodes_session_local_date
create index idx_memory_episodes_session_local_date on memory_episodes ( session_id , time_zone , local_date , started_at_ms );

-- index: idx_memory_episodes_session_time
create index idx_memory_episodes_session_time on memory_episodes ( session_id , started_at_ms );

-- index: idx_memory_sources_artifact_uri
create index idx_memory_sources_artifact_uri on memory_sources ( artifact_uri );

-- index: idx_memory_sources_episode
create index idx_memory_sources_episode on memory_sources ( episode_uri , source_kind );

-- index: idx_memory_sources_evidence_uri
create index idx_memory_sources_evidence_uri on memory_sources ( evidence_uri );

-- index: idx_memory_sources_session_local_date
create index idx_memory_sources_session_local_date on memory_sources ( session_id , time_zone , local_date , created_at_ms );

-- index: idx_memory_sources_session_request
create index idx_memory_sources_session_request on memory_sources ( session_id , request_id );

-- index: idx_pi_compaction_candidates_epoch
create index idx_pi_compaction_candidates_epoch on pi_compaction_candidates ( session_id , branch_epoch , created_at desc );

-- index: idx_pi_compaction_candidates_session_created
create index idx_pi_compaction_candidates_session_created on pi_compaction_candidates ( session_id , created_at desc , candidate_id desc );
