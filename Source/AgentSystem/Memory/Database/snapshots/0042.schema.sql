-- table: agent_agenda_actors
create table agent_agenda_actors ( id text primary key , uri text not null unique , world_id text not null , role text not null check ( role in ( 'user' , 'resident' , 'system' ) ) , created_at text not null , unique ( world_id , role ) , foreign key ( world_id ) references agent_agenda_worlds ( id ) on delete cascade );

-- table: agent_agenda_events
create table agent_agenda_events ( id text primary key , uri text not null unique , record_id text not null , sequence integer not null check ( sequence > 0 ) , idempotency_key text not null unique , event_kind text not null check ( event_kind in ( 'declared' , 'started' , 'progressed' , 'paused' , 'finished' , 'cancelled' , 'occurred' , 'due' , 'evidence_attached' ) ) , mutation_json text not null check ( json_valid ( mutation_json ) ) , source_refs_json text not null check ( json_valid ( source_refs_json ) and json_array_length ( source_refs_json ) > 0 ) , authority text not null check ( authority in ( 'user_explicit' , 'tool_verified' , 'world_definition' , 'host' ) ) , occurred_at text not null , recorded_at text not null , local_date text not null , unique ( record_id , sequence ) , foreign key ( record_id ) references agent_agenda_records ( id ) on delete cascade );

-- table: agent_agenda_records
create table agent_agenda_records ( id text primary key , uri text not null unique , world_id text not null , actor_id text not null , kind text not null check ( kind in ( 'goal' , 'activity' , 'event' , 'schedule' ) ) , created_at text not null , foreign key ( world_id ) references agent_agenda_worlds ( id ) on delete cascade , foreign key ( actor_id ) references agent_agenda_actors ( id ) on delete restrict );

-- table: agent_agenda_worlds
create table agent_agenda_worlds ( id text primary key , uri text not null unique , time_zone text not null , created_at text not null , updated_at text not null );

-- table: agent_execution_events
create table agent_execution_events ( id text primary key , execution_id text not null , event_kind text not null , step_id text , session_id text not null , request_id text not null , payload_json text not null , occurred_at text not null , foreign key ( execution_id ) references agent_execution_runs ( id ) on delete cascade , foreign key ( step_id ) references agent_execution_steps ( id ) on delete set null );

-- table: agent_execution_runs
create table agent_execution_runs ( id text primary key , uri text not null unique , session_id text not null , request_id text not null , objective text not null , status text not null check ( status in ( 'active' , 'paused' , 'blocked' , 'completed' , 'cancelled' ) ) , reason text , created_at text not null , updated_at text not null , completed_at text , unique ( session_id , request_id ) );

-- table: agent_execution_steps
create table agent_execution_steps ( id text primary key , execution_id text not null , node_id text not null , plan_id text not null , plan_revision integer not null , step_index integer not null , title text not null , detail text not null , status text not null check ( status in ( 'planned' , 'running' , 'completed' , 'failed' , 'blocked' ) ) , dependency_ids_json text not null , call_id text , failure text , created_at text not null , updated_at text not null , unique ( execution_id , node_id ) , foreign key ( execution_id ) references agent_execution_runs ( id ) on delete cascade );

-- table: agent_todos
create table agent_todos ( id text not null , session_id text not null , item_order integer not null , content text not null , status text not null check ( status in ( 'pending' , 'in_progress' , 'completed' , 'cancelled' ) ) , created_at text not null , updated_at text not null , primary key ( session_id , id ) );

-- table: agent_world_clock
create table agent_world_clock ( world_id text primary key , last_advanced_at text not null , next_wake_at text not null , updated_at text not null , foreign key ( world_id ) references agent_agenda_worlds ( id ) on delete cascade ) strict;

-- table: agent_world_events
create table agent_world_events ( id text primary key , uri text not null unique , world_id text not null , sequence integer not null check ( sequence > 0 ) , idempotency_key text not null unique , subject_id text not null , subject_kind text not null , event_type text not null , summary text not null , changes_json text not null , evidence_refs_json text not null , occurred_at text not null , recorded_at text not null , local_date text not null , foreign key ( world_id ) references agent_agenda_worlds ( id ) on delete cascade , unique ( world_id , sequence ) ) strict;

-- table: agent_world_habit_occurrences
create table agent_world_habit_occurrences ( world_id text not null , habit_id text not null , occurrence_at text not null , eligible_until text not null , outcome text not null check ( outcome in ( 'pending' , 'applied' , 'skipped' ) ) , event_uri text , reason text , recorded_at text not null , primary key ( world_id , habit_id , occurrence_at ) , foreign key ( world_id , habit_id ) references agent_world_habits ( world_id , habit_id ) on delete cascade ) strict;

-- table: agent_world_habits
create table agent_world_habits ( world_id text not null , habit_id text not null , definition_json text not null , definition_revision text not null , source_refs_json text not null , enabled integer not null check ( enabled in ( 0 , 1 ) ) , created_at text not null , updated_at text not null , primary key ( world_id , habit_id ) , foreign key ( world_id ) references agent_agenda_worlds ( id ) on delete cascade ) strict;

-- table: agent_world_machine_definitions
create table agent_world_machine_definitions ( world_id text not null , machine_id text not null , definition_json text not null , definition_revision text not null , source_refs_json text not null , created_at text not null , updated_at text not null , primary key ( world_id , machine_id ) , foreign key ( world_id ) references agent_agenda_worlds ( id ) on delete cascade ) strict;

-- table: agent_world_machine_snapshots
create table agent_world_machine_snapshots ( world_id text not null , actor_id text not null , machine_id text not null , definition_revision text not null , history_revision text not null , through_sequence integer not null check ( through_sequence >= 0 ) , snapshot_json text not null , updated_at text not null , primary key ( world_id , actor_id , machine_id ) , foreign key ( world_id ) references agent_agenda_worlds ( id ) on delete cascade ) strict;

-- table: agent_world_packages
create table agent_world_packages ( world_id text not null , package_id text not null , definition_json text not null , definition_revision text not null , source_uri text not null , applied_event_uri text not null , applied_at text not null , primary key ( world_id , package_id ) , foreign key ( world_id ) references agent_agenda_worlds ( id ) on delete cascade ) strict;

-- table: continuity_concept_aliases
create table "continuity_concept_aliases" ( concept_uri text not null , alias text not null , normalized_alias text not null , created_at text not null , primary key ( concept_uri , normalized_alias ) , foreign key ( concept_uri ) references "continuity_concepts" ( uri ) on delete cascade );

-- table: continuity_concept_relation_evidence
create table continuity_concept_relation_evidence ( relation_uri text not null , evidence_key text not null , source_refs_json text not null check ( json_valid ( source_refs_json ) ) , authority text not null check ( authority in ( 'user_explicit' , 'tool_verified' , 'system_observed' , 'model_inferred' ) ) , confidence real not null check ( confidence >= 0 and confidence <= 1 ) , observed_at text not null , primary key ( relation_uri , evidence_key ) , foreign key ( relation_uri ) references continuity_concept_relations ( uri ) on delete cascade );

-- table: continuity_concept_relation_history
create table continuity_concept_relation_history ( id text primary key , relation_uri text not null , operation text not null check ( operation in ( 'created' , 'reinforced' , 'superseded' , 'retracted' ) ) , source_refs_json text not null check ( json_valid ( source_refs_json ) ) , authority text not null check ( authority in ( 'user_explicit' , 'tool_verified' , 'system_observed' , 'model_inferred' ) ) , confidence real not null check ( confidence >= 0 and confidence <= 1 ) , occurred_at text not null , foreign key ( relation_uri ) references continuity_concept_relations ( uri ) on delete cascade );

-- table: continuity_concept_relations
create table continuity_concept_relations ( id text primary key , uri text not null unique , scope_kind text not null , scope_id text not null , subject_uri text not null , relation_id text not null , object_uri text not null , temporal_kind text not null check ( temporal_kind in ( 'persistent' , 'instant' , 'interval' , 'until_condition' , 'recurring' ) ) , valid_from text , valid_until text , time_zone text not null , status text not null check ( status in ( 'active' , 'superseded' , 'retracted' ) ) , authority text not null check ( authority in ( 'user_explicit' , 'tool_verified' , 'system_observed' , 'model_inferred' ) ) , confidence real not null check ( confidence >= 0 and confidence <= 1 ) , source_refs_json text not null check ( json_valid ( source_refs_json ) ) , support_count integer not null check ( support_count >= 0 ) , support_mass real not null check ( support_mass >= 0 and support_mass <= 1 ) , maturity text not null check ( maturity in ( 'candidate' , 'active' , 'established' ) ) , superseded_by text , created_at text not null , updated_at text not null , unique ( scope_kind , scope_id , subject_uri , relation_id , object_uri ) , foreign key ( subject_uri ) references continuity_concepts ( uri ) on delete restrict , foreign key ( object_uri ) references continuity_concepts ( uri ) on delete restrict , foreign key ( superseded_by ) references continuity_concept_relations ( uri ) on delete set null );

-- table: continuity_concepts
create table "continuity_concepts" ( id text primary key , uri text not null unique , canonical_label text not null , normalized_label text not null , entity_kind text not null default 'concept' check ( entity_kind in ( 'concept' , 'person' , 'organization' , 'place' , 'time' , 'event' , 'topic' , 'artifact' , 'preference' , 'state' , 'goal' , 'task' , 'conversation' ) ) , scope_kind text not null , scope_id text not null , status text not null check ( status in ( 'active' , 'merged' , 'retired' ) ) , merged_into_uri text , created_at text not null , updated_at text not null );

-- table: continuity_fact_evidence
create table continuity_fact_evidence ( scope_kind text not null , scope_id text not null , fact_key text not null , claim_key text not null , evidence_key text not null , source_refs_json text not null , authority text not null check ( authority in ( 'user_explicit' , 'tool_verified' , 'system_observed' , 'model_inferred' ) ) , confidence real not null check ( confidence >= 0 and confidence <= 1 ) , observed_at text not null , primary key ( scope_kind , scope_id , fact_key , claim_key , evidence_key ) );

-- table: continuity_fact_heads
create table continuity_fact_heads ( scope_kind text not null , scope_id text not null , fact_key text not null , observation_uri text not null , claim text not null , normalized_claim text not null , authority text not null , confidence real not null , valid_until text , source_refs_json text not null , status text not null check ( status in ( 'active' , 'superseded' , 'retracted' ) ) , created_at text not null , updated_at text not null , valid_from text not null default '' , superseded_by text , support_count integer not null default 0 check ( support_count >= 0 ) , support_mass real not null default 0 check ( support_mass >= 0 and support_mass <= 1 ) , maturity text not null default 'active' check ( maturity in ( 'candidate' , 'active' , 'established' ) ) , primary key ( scope_kind , scope_id , fact_key ) , foreign key ( observation_uri ) references continuity_observations ( uri ) on delete cascade );

-- table: continuity_fact_history
create table continuity_fact_history ( id text primary key , scope_kind text not null , scope_id text not null , fact_key text not null , observation_uri text not null , operation text not null check ( operation in ( 'created' , 'reinforced' , 'superseded' , 'retracted' ) ) , claim text not null , authority text not null , confidence real not null , occurred_at text not null , source_refs_json text not null , superseded_by text , foreign key ( observation_uri ) references continuity_observations ( uri ) on delete cascade );

-- table: continuity_learning_jobs
create table continuity_learning_jobs ( episode_uri text primary key , fact_status text not null check ( fact_status in ( 'pending' , 'running' , 'retry' , 'completed' , 'failed' ) ) , fact_attempts integer not null , fact_next_attempt_at_ms integer not null , fact_last_error text not null , facts_json text not null , needs_rule_pass integer not null check ( needs_rule_pass in ( 0 , 1 ) ) , rule_status text not null check ( rule_status in ( 'skipped' , 'pending' , 'running' , 'retry' , 'completed' , 'failed' ) ) , rule_attempts integer not null , rule_next_attempt_at_ms integer not null , rule_last_error text not null , updated_at_ms integer not null , foreign key ( episode_uri ) references memory_episodes ( uri ) on delete cascade );

-- table: continuity_observation_embeddings
create table continuity_observation_embeddings ( observation_uri text primary key , model text not null , text_sha256 text not null , vector_json text not null check ( json_valid ( vector_json ) ) , dimensions integer not null check ( dimensions > 0 ) , embedded_at text not null );

-- table: continuity_observations
create table continuity_observations ( id text primary key , uri text not null unique , kind text not null , summary text not null , payload_json text not null , source_refs_json text not null , watermark text not null , scope_kind text not null , scope_id text not null , authority text not null , confidence real not null , occurred_at text not null , observed_at text not null , created_at_ms integer not null );

-- table: continuity_record_concepts
create table "continuity_record_concepts" ( record_uri text not null , record_kind text not null check ( record_kind in ( 'fact' , 'profile' , 'signal' , 'rule' ) ) , concept_uri text not null , linked_at text not null , primary key ( record_uri , record_kind , concept_uri ) , foreign key ( concept_uri ) references "continuity_concepts" ( uri ) on delete cascade );

-- table: continuity_rule_evidence
create table continuity_rule_evidence ( rule_uri text not null , evidence_key text not null , source_refs_json text not null , authority text not null check ( authority in ( 'user_explicit' , 'tool_verified' , 'system_observed' , 'model_inferred' ) ) , confidence real not null check ( confidence >= 0 and confidence <= 1 ) , observed_at text not null , primary key ( rule_uri , evidence_key ) , foreign key ( rule_uri ) references continuity_rules ( uri ) on delete cascade );

-- table: continuity_rule_history
create table continuity_rule_history ( id text primary key , rule_uri text not null , operation text not null check ( operation in ( 'created' , 'reinforced' , 'revised' , 'superseded' ) ) , source_refs_json text not null , authority text not null check ( authority in ( 'user_explicit' , 'tool_verified' , 'system_observed' , 'model_inferred' ) ) , confidence real not null check ( confidence >= 0 and confidence <= 1 ) , similarity real not null check ( similarity >= 0 and similarity <= 1 ) , occurred_at text not null , foreign key ( rule_uri ) references continuity_rules ( uri ) on delete cascade );

-- table: continuity_rules
create table continuity_rules ( id text primary key , uri text not null unique , title text not null , condition_json text not null , action_json text not null , scope_kind text not null , scope_id text not null , authority text not null , confidence real not null , temporal_kind text not null , valid_from text , valid_until text , time_zone text not null , source_refs_json text not null , status text not null , last_evaluated_at text , last_triggered_at text , created_at text not null , updated_at text not null , fingerprint text not null default '' , semantic_key text not null default '' , condition_key text not null default '' , effect_key text not null default '' , support_count integer not null default 1 check ( support_count >= 0 ) , support_mass real not null default 0 check ( support_mass >= 0 and support_mass <= 1 ) , maturity text not null default 'active' check ( maturity in ( 'candidate' , 'active' , 'established' ) ) , superseded_by text );

-- table: continuity_signal_evidence
create table continuity_signal_evidence ( scope_kind text not null , scope_id text not null , namespace text not null , signal_key text not null , evidence_key text not null , value_json text not null , value_type text not null check ( value_type in ( 'boolean' , 'number' , 'string' , 'json' ) ) , authority text not null check ( authority in ( 'user_explicit' , 'tool_verified' , 'system_observed' , 'model_inferred' ) ) , confidence real not null check ( confidence >= 0 and confidence <= 1 ) , observed_at text not null , expires_at text , source_refs_json text not null , primary key ( scope_kind , scope_id , namespace , signal_key , evidence_key ) );

-- table: continuity_signals
create table continuity_signals ( scope_kind text not null , scope_id text not null , namespace text not null , signal_key text not null , value_json text not null , value_type text not null , authority text not null , confidence real not null , observed_at text not null , expires_at text , source_refs_json text not null , primary key ( scope_kind , scope_id , namespace , signal_key ) );

-- table: continuity_stable_prompt_snapshots
create table continuity_stable_prompt_snapshots ( session_id text primary key , revision text not null , resident_profile_json text not null , created_at text not null );

-- table: continuity_turn_value_examples
create table "continuity_turn_value_examples" ( prompt_hash text not null , occurrences integer not null check ( occurrences >= 0 ) , first_seen_at text not null , last_seen_at text not null , prompt_text text not null default '' , label text not null check ( label in ( 'valuable' , 'unproductive' ) ) , primary key ( prompt_hash , label ) );

-- table: memory_catalog_state
create table memory_catalog_state ( catalog text primary key , revision integer not null check ( revision >= 0 ) );

-- table: memory_episodes
create table memory_episodes ( id text primary key , uri text not null unique , session_id text not null , request_id text not null , status text not null , raw_user_text text not null , standalone_request text not null , context_mode text not null , context_basis text not null , topic text not null , summary text not null , started_at text not null , completed_at text not null , updated_at text not null , started_at_ms integer not null , completed_at_ms integer not null , updated_at_ms integer not null , time_zone text not null , local_date text not null , local_hour text not null , metadata_json text not null , unique ( session_id , request_id ) );

-- table: memory_sources
create table memory_sources ( id text primary key , uri text not null unique , episode_id text not null , episode_uri text not null , session_id text not null , request_id text not null , source_kind text not null , role text not null , text_content text , summary text , conversation_entry_id text not null , evidence_uri text not null , artifact_uri text not null , tool_name text not null , created_at text not null , updated_at text not null , created_at_ms integer not null , updated_at_ms integer not null , time_zone text not null , local_date text not null , local_hour text not null , metadata_json text not null , foreign key ( episode_id ) references memory_episodes ( id ) on delete cascade );

-- table: memory_temporal_digest_jobs
create table memory_temporal_digest_jobs ( digest_id text primary key , next_attempt_at_ms integer not null , attempt_count integer not null default 0 check ( attempt_count >= 0 ) , last_error text , updated_at text not null , foreign key ( digest_id ) references memory_temporal_digests ( id ) on delete cascade ) strict;

-- table: memory_temporal_digest_members
create table memory_temporal_digest_members ( digest_id text not null , member_uri text not null , member_kind text not null check ( member_kind in ( 'episode' , 'digest' ) ) , ordinal integer not null check ( ordinal >= 0 ) , occurred_at text not null , source_revision text not null , primary key ( digest_id , member_uri ) , foreign key ( digest_id ) references memory_temporal_digests ( id ) on delete cascade ) strict;

-- table: memory_temporal_digests
create table memory_temporal_digests ( id text primary key , uri text not null unique , scope_key text not null , workspace_id text not null , account_id text , user_id text , world_id text , granularity text not null check ( granularity in ( 'segment' , 'day' , 'month' ) ) , digest_key text not null , session_id text not null default '' , period_start text not null , period_end text not null , period_start_ms integer not null , period_end_ms integer not null check ( period_end_ms >= period_start_ms ) , time_zone text not null , status text not null check ( status in ( 'open' , 'pending' , 'sealed' , 'failed' , 'stale' ) ) , summary text not null default '' , topics_json text not null default '[]' , open_loops_json text not null default '[]' , source_revision text not null , child_count integer not null default 0 check ( child_count >= 0 ) , created_at text not null , updated_at text not null , working_focus text not null default '' , unique ( scope_key , granularity , digest_key ) ) strict;

-- table: memory_temporal_segment_decisions
create table memory_temporal_segment_decisions ( episode_uri text primary key , scope_key text not null , session_id text not null , source_revision text not null , completed_at_ms integer not null , status text not null check ( status in ( 'pending' , 'resolved' , 'failed' ) ) , relation text check ( relation is null or relation in ( 'start' , 'continue' , 'boundary' ) ) , confidence real check ( confidence is null or ( confidence >= 0 and confidence <= 1 ) ) , predecessor_digest_uri text , assigned_digest_uri text , next_attempt_at_ms integer not null , attempt_count integer not null default 0 check ( attempt_count >= 0 ) , last_error text , created_at text not null , updated_at text not null , foreign key ( episode_uri ) references memory_episodes ( uri ) on delete cascade ) strict;

-- table: resident_profile_evidence
create table resident_profile_evidence ( profile_id text not null , evidence_key text not null , source_refs_json text not null , authority text not null check ( authority in ( 'user_explicit' , 'tool_verified' , 'system_observed' , 'model_inferred' ) ) , confidence real not null check ( confidence >= 0 and confidence <= 1 ) , observed_at text not null , primary key ( profile_id , evidence_key ) , foreign key ( profile_id ) references resident_profile_records ( id ) on delete cascade );

-- table: resident_profile_history
create table resident_profile_history ( id text primary key , profile_id text not null , operation text not null check ( operation in ( 'created' , 'reinforced' , 'superseded' , 'retracted' ) ) , source_refs_json text not null , authority text not null check ( authority in ( 'user_explicit' , 'tool_verified' , 'system_observed' , 'model_inferred' ) ) , confidence real not null check ( confidence >= 0 and confidence <= 1 ) , occurred_at text not null , foreign key ( profile_id ) references resident_profile_records ( id ) on delete cascade );

-- table: resident_profile_records
create table resident_profile_records ( id text primary key , uri text not null unique , subject text not null check ( subject in ( 'agent' , 'user' ) ) , profile_key text not null , value_json text not null , value_type text not null check ( value_type in ( 'boolean' , 'number' , 'string' ) ) , scope_kind text not null check ( scope_kind in ( 'user' , 'session' , 'workspace' , 'world' , 'account' , 'runtime' ) ) , scope_id text not null , authority text not null check ( authority in ( 'user_explicit' , 'tool_verified' , 'system_observed' , 'model_inferred' ) ) , confidence real not null check ( confidence >= 0 and confidence <= 1 ) , valid_until text not null , time_zone text not null , source_refs_json text not null , status text not null check ( status in ( 'active' , 'superseded' , 'retracted' ) ) , created_at text not null , updated_at text not null , superseded_by text , support_count integer not null default 1 , maturity text not null default 'active' check ( maturity in ( 'candidate' , 'active' , 'established' ) ) );

-- trigger: continuity_concept_alias_graph_revision_delete
create trigger continuity_concept_alias_graph_revision_delete after delete on continuity_concept_aliases begin update memory_catalog_state set revision = revision + 1 where catalog = 'continuity_graph' ; end;

-- trigger: continuity_concept_alias_graph_revision_insert
create trigger continuity_concept_alias_graph_revision_insert after insert on continuity_concept_aliases begin update memory_catalog_state set revision = revision + 1 where catalog = 'continuity_graph' ; end;

-- trigger: continuity_concept_alias_graph_revision_update
create trigger continuity_concept_alias_graph_revision_update after update on continuity_concept_aliases begin update memory_catalog_state set revision = revision + 1 where catalog = 'continuity_graph' ; end;

-- trigger: continuity_concept_graph_revision_delete
create trigger continuity_concept_graph_revision_delete after delete on continuity_concepts begin update memory_catalog_state set revision = revision + 1 where catalog = 'continuity_graph' ; end;

-- trigger: continuity_concept_graph_revision_insert
create trigger continuity_concept_graph_revision_insert after insert on continuity_concepts begin update memory_catalog_state set revision = revision + 1 where catalog = 'continuity_graph' ; end;

-- trigger: continuity_concept_graph_revision_update
create trigger continuity_concept_graph_revision_update after update on continuity_concepts begin update memory_catalog_state set revision = revision + 1 where catalog = 'continuity_graph' ; end;

-- trigger: continuity_observation_concept_links_delete
create trigger continuity_observation_concept_links_delete after delete on continuity_observations begin delete from continuity_record_concepts where record_kind = 'fact' and record_uri = old . uri ; delete from continuity_concepts where status = 'active' and not exists ( select 1 from continuity_record_concepts where continuity_record_concepts . concept_uri = continuity_concepts . uri ) and not exists ( select 1 from continuity_concept_relations where continuity_concept_relations . subject_uri = continuity_concepts . uri or continuity_concept_relations . object_uri = continuity_concepts . uri ) ; end;

-- trigger: continuity_record_concept_graph_revision_delete
create trigger continuity_record_concept_graph_revision_delete after delete on continuity_record_concepts begin update memory_catalog_state set revision = revision + 1 where catalog = 'continuity_graph' ; end;

-- trigger: continuity_record_concept_graph_revision_insert
create trigger continuity_record_concept_graph_revision_insert after insert on continuity_record_concepts begin update memory_catalog_state set revision = revision + 1 where catalog = 'continuity_graph' ; end;

-- trigger: continuity_record_concept_graph_revision_update
create trigger continuity_record_concept_graph_revision_update after update on continuity_record_concepts begin update memory_catalog_state set revision = revision + 1 where catalog = 'continuity_graph' ; end;

-- trigger: continuity_relation_evidence_graph_revision_delete
create trigger continuity_relation_evidence_graph_revision_delete after delete on continuity_concept_relation_evidence begin update memory_catalog_state set revision = revision + 1 where catalog = 'continuity_graph' ; end;

-- trigger: continuity_relation_evidence_graph_revision_insert
create trigger continuity_relation_evidence_graph_revision_insert after insert on continuity_concept_relation_evidence begin update memory_catalog_state set revision = revision + 1 where catalog = 'continuity_graph' ; end;

-- trigger: continuity_relation_evidence_graph_revision_update
create trigger continuity_relation_evidence_graph_revision_update after update on continuity_concept_relation_evidence begin update memory_catalog_state set revision = revision + 1 where catalog = 'continuity_graph' ; end;

-- trigger: continuity_relation_graph_revision_delete
create trigger continuity_relation_graph_revision_delete after delete on continuity_concept_relations begin update memory_catalog_state set revision = revision + 1 where catalog = 'continuity_graph' ; end;

-- trigger: continuity_relation_graph_revision_insert
create trigger continuity_relation_graph_revision_insert after insert on continuity_concept_relations begin update memory_catalog_state set revision = revision + 1 where catalog = 'continuity_graph' ; end;

-- trigger: continuity_relation_graph_revision_update
create trigger continuity_relation_graph_revision_update after update on continuity_concept_relations begin update memory_catalog_state set revision = revision + 1 where catalog = 'continuity_graph' ; end;

-- trigger: continuity_rule_concept_links_delete
create trigger continuity_rule_concept_links_delete after delete on continuity_rules begin delete from continuity_record_concepts where record_kind = 'rule' and record_uri = old . uri ; delete from continuity_concepts where status = 'active' and not exists ( select 1 from continuity_record_concepts where continuity_record_concepts . concept_uri = continuity_concepts . uri ) and not exists ( select 1 from continuity_concept_relations where continuity_concept_relations . subject_uri = continuity_concepts . uri or continuity_concept_relations . object_uri = continuity_concepts . uri ) ; end;

-- trigger: continuity_signal_concept_links_delete
create trigger continuity_signal_concept_links_delete after delete on continuity_signals begin delete from continuity_record_concepts where record_kind = 'signal' ; delete from continuity_concepts where status = 'active' and not exists ( select 1 from continuity_record_concepts where continuity_record_concepts . concept_uri = continuity_concepts . uri ) and not exists ( select 1 from continuity_concept_relations where continuity_concept_relations . subject_uri = continuity_concepts . uri or continuity_concept_relations . object_uri = continuity_concepts . uri ) ; end;

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

-- trigger: resident_profile_concept_links_delete
create trigger resident_profile_concept_links_delete after delete on resident_profile_records begin delete from continuity_record_concepts where record_kind = 'profile' and record_uri = old . uri ; delete from continuity_concepts where status = 'active' and not exists ( select 1 from continuity_record_concepts where continuity_record_concepts . concept_uri = continuity_concepts . uri ) and not exists ( select 1 from continuity_concept_relations where continuity_concept_relations . subject_uri = continuity_concepts . uri or continuity_concept_relations . object_uri = continuity_concepts . uri ) ; end;

-- index: idx_agent_agenda_events_local_date
create index idx_agent_agenda_events_local_date on agent_agenda_events ( local_date , occurred_at , id );

-- index: idx_agent_agenda_events_record_time
create index idx_agent_agenda_events_record_time on agent_agenda_events ( record_id , occurred_at , recorded_at , id );

-- index: idx_agent_agenda_records_world
create index idx_agent_agenda_records_world on agent_agenda_records ( world_id , created_at , id );

-- index: idx_agent_execution_events_execution_time
create index idx_agent_execution_events_execution_time on agent_execution_events ( execution_id , occurred_at );

-- index: idx_agent_execution_runs_session_status
create index idx_agent_execution_runs_session_status on agent_execution_runs ( session_id , status , updated_at );

-- index: idx_agent_execution_steps_execution_status
create index idx_agent_execution_steps_execution_status on agent_execution_steps ( execution_id , status , step_index );

-- index: idx_agent_todos_session_order
create index idx_agent_todos_session_order on agent_todos ( session_id , item_order , id );

-- index: idx_agent_world_events_world_subject
create index idx_agent_world_events_world_subject on agent_world_events ( world_id , subject_id , sequence );

-- index: idx_agent_world_events_world_time
create index idx_agent_world_events_world_time on agent_world_events ( world_id , occurred_at , sequence );

-- index: idx_agent_world_habit_occurrences_due
create index idx_agent_world_habit_occurrences_due on agent_world_habit_occurrences ( world_id , occurrence_at , outcome );

-- index: idx_agent_world_packages_world_revision
create index idx_agent_world_packages_world_revision on agent_world_packages ( world_id , definition_revision );

-- index: idx_continuity_concept_alias_lookup
create index idx_continuity_concept_alias_lookup on continuity_concept_aliases ( normalized_alias , concept_uri );

-- index: idx_continuity_concept_relation_evidence_source
create index idx_continuity_concept_relation_evidence_source on continuity_concept_relation_evidence ( evidence_key );

-- index: idx_continuity_concept_relation_history_relation
create index idx_continuity_concept_relation_history_relation on continuity_concept_relation_history ( relation_uri , occurred_at desc );

-- index: idx_continuity_concept_relations_object
create index idx_continuity_concept_relations_object on continuity_concept_relations ( scope_kind , scope_id , object_uri , status , relation_id );

-- index: idx_continuity_concept_relations_scope
create index idx_continuity_concept_relations_scope on continuity_concept_relations ( scope_kind , scope_id , status , updated_at desc );

-- index: idx_continuity_concept_relations_subject
create index idx_continuity_concept_relations_subject on continuity_concept_relations ( scope_kind , scope_id , subject_uri , status , relation_id );

-- index: idx_continuity_concepts_active_label
create unique index idx_continuity_concepts_active_label on continuity_concepts ( scope_kind , scope_id , normalized_label ) where status = 'active';

-- index: idx_continuity_concepts_merged_into
create index idx_continuity_concepts_merged_into on continuity_concepts ( merged_into_uri );

-- index: idx_continuity_concepts_scope
create index idx_continuity_concepts_scope on continuity_concepts ( scope_kind , scope_id , status , entity_kind , updated_at );

-- index: idx_continuity_fact_evidence_head
create index idx_continuity_fact_evidence_head on continuity_fact_evidence ( scope_kind , scope_id , fact_key , claim_key , observed_at desc );

-- index: idx_continuity_fact_evidence_source
create index idx_continuity_fact_evidence_source on continuity_fact_evidence ( evidence_key );

-- index: idx_continuity_fact_heads_active
create index idx_continuity_fact_heads_active on continuity_fact_heads ( scope_kind , scope_id , status , updated_at desc );

-- index: idx_continuity_fact_heads_observation_status
create index idx_continuity_fact_heads_observation_status on continuity_fact_heads ( observation_uri , status );

-- index: idx_continuity_fact_heads_superseded_by
create index idx_continuity_fact_heads_superseded_by on continuity_fact_heads ( superseded_by );

-- index: idx_continuity_fact_history_key_time
create index idx_continuity_fact_history_key_time on continuity_fact_history ( scope_kind , scope_id , fact_key , occurred_at desc );

-- index: idx_continuity_fact_history_observation
create index idx_continuity_fact_history_observation on continuity_fact_history ( observation_uri );

-- index: idx_continuity_learning_jobs_fact_due
create index idx_continuity_learning_jobs_fact_due on continuity_learning_jobs ( fact_status , fact_next_attempt_at_ms , updated_at_ms );

-- index: idx_continuity_learning_jobs_rule_due
create index idx_continuity_learning_jobs_rule_due on continuity_learning_jobs ( rule_status , rule_next_attempt_at_ms , updated_at_ms );

-- index: idx_continuity_observation_embeddings_model
create index idx_continuity_observation_embeddings_model on continuity_observation_embeddings ( model , embedded_at desc );

-- index: idx_continuity_observations_kind_time
create index idx_continuity_observations_kind_time on continuity_observations ( kind , created_at_ms );

-- index: idx_continuity_observations_scope_time
create index idx_continuity_observations_scope_time on continuity_observations ( scope_kind , scope_id , created_at_ms );

-- index: idx_continuity_record_concepts_concept
create index idx_continuity_record_concepts_concept on continuity_record_concepts ( concept_uri , record_kind , record_uri );

-- index: idx_continuity_record_concepts_record
create index idx_continuity_record_concepts_record on continuity_record_concepts ( record_uri , record_kind , linked_at );

-- index: idx_continuity_rule_history_rule_time
create index idx_continuity_rule_history_rule_time on continuity_rule_history ( rule_uri , occurred_at );

-- index: idx_continuity_rules_consolidation_candidates
create index idx_continuity_rules_consolidation_candidates on continuity_rules ( scope_kind , scope_id , condition_key , status , superseded_by );

-- index: idx_continuity_rules_scope_fingerprint
create unique index idx_continuity_rules_scope_fingerprint on continuity_rules ( scope_kind , scope_id , fingerprint );

-- index: idx_continuity_rules_scope_status
create index idx_continuity_rules_scope_status on continuity_rules ( scope_kind , scope_id , status , valid_until );

-- index: idx_continuity_signal_evidence_expiry
create index idx_continuity_signal_evidence_expiry on continuity_signal_evidence ( expires_at );

-- index: idx_continuity_signal_evidence_identity
create index idx_continuity_signal_evidence_identity on continuity_signal_evidence ( scope_kind , scope_id , namespace , signal_key , observed_at );

-- index: idx_continuity_signals_expiry
create index idx_continuity_signals_expiry on continuity_signals ( expires_at );

-- index: idx_continuity_turn_value_examples_last_seen
create index idx_continuity_turn_value_examples_last_seen on continuity_turn_value_examples ( last_seen_at desc , prompt_hash asc );

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

-- index: idx_memory_temporal_digest_jobs_due
create index idx_memory_temporal_digest_jobs_due on memory_temporal_digest_jobs ( next_attempt_at_ms , digest_id );

-- index: idx_memory_temporal_digest_members_source
create index idx_memory_temporal_digest_members_source on memory_temporal_digest_members ( member_uri , digest_id );

-- index: idx_memory_temporal_digests_scope_period
create index idx_memory_temporal_digests_scope_period on memory_temporal_digests ( scope_key , granularity , period_start_ms , period_end_ms , status );

-- index: idx_memory_temporal_segment_decisions_due
create index idx_memory_temporal_segment_decisions_due on memory_temporal_segment_decisions ( status , next_attempt_at_ms , completed_at_ms , episode_uri );

-- index: idx_memory_temporal_segment_decisions_session
create index idx_memory_temporal_segment_decisions_session on memory_temporal_segment_decisions ( session_id , completed_at_ms , episode_uri );

-- index: idx_resident_profile_active_scope
create index idx_resident_profile_active_scope on resident_profile_records ( scope_kind , scope_id , subject , profile_key , status , updated_at desc );

-- index: idx_resident_profile_evidence_profile
create index idx_resident_profile_evidence_profile on resident_profile_evidence ( profile_id , observed_at desc );

-- index: idx_resident_profile_history_profile_time
create index idx_resident_profile_history_profile_time on resident_profile_history ( profile_id , occurred_at desc , id asc );

-- index: idx_resident_profile_records_superseded_by
create index idx_resident_profile_records_superseded_by on resident_profile_records ( superseded_by );

-- index: idx_resident_profile_valid_until
create index idx_resident_profile_valid_until on resident_profile_records ( status , valid_until );
