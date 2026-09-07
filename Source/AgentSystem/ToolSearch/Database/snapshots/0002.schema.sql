-- table: learning_episodes
create table learning_episodes ( id text primary key , domain text not null check ( domain in ( 'tool_routing' , 'skill_routing' ) ) , state text not null check ( state in ( 'observed' , 'learned' , 'skipped' , 'failed' ) ) , reason text not null , error text not null , attempts integer not null , project_id text not null , session_id text not null , request_id text not null , query text not null , subjects_json text not null , context_json text not null , outcome_json text not null , created_at_ms integer not null , updated_at_ms integer not null );

-- table: skill_learning_terms
create table skill_learning_terms ( project_id text not null , skill_name text not null , skill_revision text not null , term text not null , source text not null , support real not null , weight real not null , last_seen_at integer not null , primary key ( project_id , skill_name , skill_revision , term , source ) );

-- table: tool_learning_terms
create table tool_learning_terms ( project_id text not null , tool_name text not null , term text not null , source text not null , support real not null , weight real not null , last_seen_at integer not null , primary key ( project_id , tool_name , term , source ) );

-- table: tool_search_episodes
create table tool_search_episodes ( id integer primary key autoincrement , query text not null , query_tokens text not null , planner_tags text not null , candidates text not null , chosen_tools text not null , learned_keywords text not null , outcome text not null , calls text not null , final_score real not null , final_outcome text not null , project_id text not null , timestamp integer not null );

-- table: tool_use_patterns
create table tool_use_patterns ( project_id text not null , tool_name text not null , pattern_key text not null , trigger_terms text not null , argument_keys text not null , evidence_kinds text not null , support real not null , last_seen_at integer not null , primary key ( project_id , tool_name , pattern_key ) );

-- index: idx_learning_episodes_project_time
create index idx_learning_episodes_project_time on learning_episodes ( project_id , updated_at_ms desc );

-- index: idx_learning_episodes_request
create index idx_learning_episodes_request on learning_episodes ( request_id , domain , updated_at_ms desc );

-- index: idx_learning_episodes_state
create index idx_learning_episodes_state on learning_episodes ( project_id , domain , state , updated_at_ms desc );

-- index: idx_skill_learning_terms_project_skill
create index idx_skill_learning_terms_project_skill on skill_learning_terms ( project_id , skill_name , skill_revision );

-- index: idx_tool_learning_terms_project_tool
create index idx_tool_learning_terms_project_tool on tool_learning_terms ( project_id , tool_name );

-- index: idx_tool_search_episodes_project_time
create index idx_tool_search_episodes_project_time on tool_search_episodes ( project_id , timestamp desc );

-- index: idx_tool_use_patterns_project_tool
create index idx_tool_use_patterns_project_tool on tool_use_patterns ( project_id , tool_name );
