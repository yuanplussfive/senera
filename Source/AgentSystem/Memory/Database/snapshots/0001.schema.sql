-- table: memory_candidates
create table memory_candidates ( id text primary key , uri text not null unique , type text not null , subject text not null , claim text not null , how_to_apply text not null , tags_json text not null , triggers_json text not null , source_refs_json text not null , status text not null , confidence real not null , embedding_json text not null , session_id text not null , source_episode_uri text not null , source_request_id text not null , promoted_memory_uri text not null , created_at text not null , updated_at text not null , created_at_ms integer not null , updated_at_ms integer not null , time_zone text not null , local_date text not null , local_hour text not null , metadata_json text not null , foreign key ( source_episode_uri ) references memory_episodes ( uri ) on delete cascade );

-- table: memory_episodes
create table memory_episodes ( id text primary key , uri text not null unique , session_id text not null , request_id text not null , status text not null , raw_user_text text not null , standalone_request text not null , context_mode text not null , context_basis text not null , topic text not null , summary text not null , started_at text not null , completed_at text not null , updated_at text not null , started_at_ms integer not null , completed_at_ms integer not null , updated_at_ms integer not null , time_zone text not null , local_date text not null , local_hour text not null , metadata_json text not null , unique ( session_id , request_id ) );

-- table: memory_item_vectors
create table memory_item_vectors ( memory_uri text not null , model text not null , dimensions integer not null , embedding_json text not null , updated_at text not null , updated_at_ms integer not null , primary key ( memory_uri , model ) , foreign key ( memory_uri ) references memory_items ( uri ) on delete cascade );

-- table: memory_items
create table memory_items ( id text primary key , uri text not null unique , type text not null , subject text not null , claim text not null , how_to_apply text not null , tags_json text not null , triggers_json text not null , source_refs_json text not null , status text not null , confidence real not null , session_id text not null , source_episode_uri text not null , source_request_id text not null , created_at text not null , updated_at text not null , created_at_ms integer not null , updated_at_ms integer not null , time_zone text not null , local_date text not null , local_hour text not null , metadata_json text not null , foreign key ( source_episode_uri ) references memory_episodes ( uri ) on delete cascade );

-- table: memory_observations
create table memory_observations ( id text primary key , uri text not null unique , memory_uri text not null , operation text not null , candidate_uris_json text not null , source_refs_json text not null , reason text not null , confidence real not null , session_id text not null , source_episode_uri text not null , source_request_id text not null , created_at text not null , created_at_ms integer not null , time_zone text not null , local_date text not null , local_hour text not null , metadata_json text not null , foreign key ( memory_uri ) references memory_items ( uri ) on delete cascade , foreign key ( source_episode_uri ) references memory_episodes ( uri ) on delete cascade );

-- table: memory_sources
create table memory_sources ( id text primary key , uri text not null unique , episode_id text not null , episode_uri text not null , session_id text not null , request_id text not null , source_kind text not null , role text not null , text_content text , summary text , conversation_entry_id text not null , evidence_uri text not null , artifact_uri text not null , tool_name text not null , created_at text not null , updated_at text not null , created_at_ms integer not null , updated_at_ms integer not null , time_zone text not null , local_date text not null , local_hour text not null , metadata_json text not null , foreign key ( episode_id ) references memory_episodes ( id ) on delete cascade );

-- index: idx_memory_candidates_local_date
create index idx_memory_candidates_local_date on memory_candidates ( session_id , time_zone , local_date , created_at_ms );

-- index: idx_memory_candidates_status_type
create index idx_memory_candidates_status_type on memory_candidates ( session_id , status , type , created_at_ms );

-- index: idx_memory_episodes_session_local_date
create index idx_memory_episodes_session_local_date on memory_episodes ( session_id , time_zone , local_date , started_at_ms );

-- index: idx_memory_episodes_session_time
create index idx_memory_episodes_session_time on memory_episodes ( session_id , started_at_ms );

-- index: idx_memory_item_vectors_model
create index idx_memory_item_vectors_model on memory_item_vectors ( model , updated_at_ms );

-- index: idx_memory_items_local_date
create index idx_memory_items_local_date on memory_items ( time_zone , local_date , updated_at_ms );

-- index: idx_memory_items_session_time
create index idx_memory_items_session_time on memory_items ( session_id , updated_at_ms );

-- index: idx_memory_items_status_type
create index idx_memory_items_status_type on memory_items ( status , type , updated_at_ms );

-- index: idx_memory_observations_memory_time
create index idx_memory_observations_memory_time on memory_observations ( memory_uri , created_at_ms );

-- index: idx_memory_observations_session_time
create index idx_memory_observations_session_time on memory_observations ( session_id , created_at_ms );

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
