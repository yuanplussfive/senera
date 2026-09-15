-- table: continuity_learning_jobs
create table continuity_learning_jobs ( episode_uri text primary key , status text not null check ( status in ( 'pending' , 'running' , 'retry' , 'completed' , 'failed' ) ) , attempts integer not null , next_attempt_at_ms integer not null , last_error text not null , updated_at_ms integer not null , foreign key ( episode_uri ) references memory_episodes ( uri ) on delete cascade );

-- table: continuity_observations
create table continuity_observations ( id text primary key , uri text not null unique , kind text not null , summary text not null , payload_json text not null , source_refs_json text not null , watermark text not null , scope_kind text not null , scope_id text not null , authority text not null , confidence real not null , occurred_at text not null , observed_at text not null , created_at_ms integer not null );

-- table: continuity_rules
create table continuity_rules ( id text primary key , uri text not null unique , title text not null , condition_json text not null , action_json text not null , scope_kind text not null , scope_id text not null , authority text not null , confidence real not null , temporal_kind text not null , valid_from text , valid_until text , time_zone text not null , source_refs_json text not null , status text not null , last_evaluated_at text , last_triggered_at text , created_at text not null , updated_at text not null , fingerprint text not null default '' );

-- table: continuity_signals
create table continuity_signals ( scope_kind text not null , scope_id text not null , namespace text not null , signal_key text not null , value_json text not null , value_type text not null , authority text not null , confidence real not null , observed_at text not null , expires_at text , source_refs_json text not null , primary key ( scope_kind , scope_id , namespace , signal_key ) );

-- table: memory_episodes
create table memory_episodes ( id text primary key , uri text not null unique , session_id text not null , request_id text not null , status text not null , raw_user_text text not null , standalone_request text not null , context_mode text not null , context_basis text not null , topic text not null , summary text not null , started_at text not null , completed_at text not null , updated_at text not null , started_at_ms integer not null , completed_at_ms integer not null , updated_at_ms integer not null , time_zone text not null , local_date text not null , local_hour text not null , metadata_json text not null , unique ( session_id , request_id ) );

-- table: memory_sources
create table memory_sources ( id text primary key , uri text not null unique , episode_id text not null , episode_uri text not null , session_id text not null , request_id text not null , source_kind text not null , role text not null , text_content text , summary text , conversation_entry_id text not null , evidence_uri text not null , artifact_uri text not null , tool_name text not null , created_at text not null , updated_at text not null , created_at_ms integer not null , updated_at_ms integer not null , time_zone text not null , local_date text not null , local_hour text not null , metadata_json text not null , foreign key ( episode_id ) references memory_episodes ( id ) on delete cascade );

-- index: idx_continuity_learning_jobs_due
create index idx_continuity_learning_jobs_due on continuity_learning_jobs ( status , next_attempt_at_ms , updated_at_ms );

-- index: idx_continuity_observations_kind_time
create index idx_continuity_observations_kind_time on continuity_observations ( kind , created_at_ms );

-- index: idx_continuity_observations_scope_time
create index idx_continuity_observations_scope_time on continuity_observations ( scope_kind , scope_id , created_at_ms );

-- index: idx_continuity_rules_scope_fingerprint
create unique index idx_continuity_rules_scope_fingerprint on continuity_rules ( scope_kind , scope_id , fingerprint );

-- index: idx_continuity_rules_scope_status
create index idx_continuity_rules_scope_status on continuity_rules ( scope_kind , scope_id , status , valid_until );

-- index: idx_continuity_signals_expiry
create index idx_continuity_signals_expiry on continuity_signals ( expires_at );

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
