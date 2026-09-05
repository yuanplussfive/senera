-- table: agent_goal_events
create table agent_goal_events ( id text primary key , goal_id text not null , event_kind text not null , step_id text , session_id text not null , request_id text not null , payload_json text not null , occurred_at text not null , foreign key ( goal_id ) references agent_goals ( id ) on delete cascade , foreign key ( step_id ) references agent_goal_steps ( id ) on delete set null );

-- table: agent_goal_steps
create table agent_goal_steps ( id text primary key , goal_id text not null , node_id text not null , plan_id text not null , plan_revision integer not null , step_index integer not null , title text not null , detail text not null , status text not null check ( status in ( 'planned' , 'running' , 'completed' , 'failed' , 'blocked' ) ) , dependency_ids_json text not null , call_id text , failure text , created_at text not null , updated_at text not null , unique ( goal_id , node_id ) , foreign key ( goal_id ) references agent_goals ( id ) on delete cascade );

-- table: agent_goals
create table agent_goals ( id text primary key , uri text not null unique , session_id text not null , request_id text not null , objective text not null , status text not null check ( status in ( 'active' , 'paused' , 'blocked' , 'completed' , 'cancelled' ) ) , reason text , created_at text not null , updated_at text not null , completed_at text , unique ( session_id , request_id ) );

-- table: continuity_fact_heads
create table continuity_fact_heads ( scope_kind text not null , scope_id text not null , fact_key text not null , observation_uri text not null , claim text not null , normalized_claim text not null , authority text not null , confidence real not null , valid_until text , source_refs_json text not null , status text not null check ( status in ( 'active' , 'superseded' , 'retracted' ) ) , created_at text not null , updated_at text not null , primary key ( scope_kind , scope_id , fact_key ) , foreign key ( observation_uri ) references continuity_observations ( uri ) on delete cascade );

-- table: continuity_fact_history
create table continuity_fact_history ( id text primary key , scope_kind text not null , scope_id text not null , fact_key text not null , observation_uri text not null , operation text not null check ( operation in ( 'created' , 'reinforced' , 'superseded' , 'retracted' ) ) , claim text not null , authority text not null , confidence real not null , occurred_at text not null , source_refs_json text not null , foreign key ( observation_uri ) references continuity_observations ( uri ) on delete cascade );

-- table: continuity_learning_jobs
create table continuity_learning_jobs ( episode_uri text primary key , fact_status text not null check ( fact_status in ( 'pending' , 'running' , 'retry' , 'completed' , 'failed' ) ) , fact_attempts integer not null , fact_next_attempt_at_ms integer not null , fact_last_error text not null , facts_json text not null , needs_rule_pass integer not null check ( needs_rule_pass in ( 0 , 1 ) ) , rule_status text not null check ( rule_status in ( 'skipped' , 'pending' , 'running' , 'retry' , 'completed' , 'failed' ) ) , rule_attempts integer not null , rule_next_attempt_at_ms integer not null , rule_last_error text not null , updated_at_ms integer not null , foreign key ( episode_uri ) references memory_episodes ( uri ) on delete cascade );

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

-- table: resident_profile_records
create table resident_profile_records ( id text primary key , uri text not null unique , subject text not null check ( subject in ( 'agent' , 'user' ) ) , profile_key text not null , value_json text not null , value_type text not null check ( value_type in ( 'boolean' , 'number' , 'string' ) ) , scope_kind text not null check ( scope_kind in ( 'user' , 'session' , 'workspace' , 'world' , 'account' , 'runtime' ) ) , scope_id text not null , authority text not null check ( authority in ( 'user_explicit' , 'tool_verified' , 'system_observed' , 'model_inferred' ) ) , confidence real not null check ( confidence >= 0 and confidence <= 1 ) , valid_until text not null , time_zone text not null , source_refs_json text not null , status text not null check ( status in ( 'active' , 'superseded' , 'retracted' ) ) , created_at text not null , updated_at text not null );

-- index: idx_agent_goal_events_goal_time
create index idx_agent_goal_events_goal_time on agent_goal_events ( goal_id , occurred_at );

-- index: idx_agent_goal_steps_goal_status
create index idx_agent_goal_steps_goal_status on agent_goal_steps ( goal_id , status , step_index );

-- index: idx_agent_goals_session_status
create index idx_agent_goals_session_status on agent_goals ( session_id , status , updated_at );

-- index: idx_continuity_fact_heads_active
create index idx_continuity_fact_heads_active on continuity_fact_heads ( scope_kind , scope_id , status , updated_at desc );

-- index: idx_continuity_fact_history_key_time
create index idx_continuity_fact_history_key_time on continuity_fact_history ( scope_kind , scope_id , fact_key , occurred_at desc );

-- index: idx_continuity_learning_jobs_fact_due
create index idx_continuity_learning_jobs_fact_due on continuity_learning_jobs ( fact_status , fact_next_attempt_at_ms , updated_at_ms );

-- index: idx_continuity_learning_jobs_rule_due
create index idx_continuity_learning_jobs_rule_due on continuity_learning_jobs ( rule_status , rule_next_attempt_at_ms , updated_at_ms );

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

-- index: idx_resident_profile_active_scope
create index idx_resident_profile_active_scope on resident_profile_records ( scope_kind , scope_id , subject , profile_key , status , updated_at desc );

-- index: idx_resident_profile_valid_until
create index idx_resident_profile_valid_until on resident_profile_records ( status , valid_until );
