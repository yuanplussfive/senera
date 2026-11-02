-- table: app_settings
create table app_settings ( key text primary key , value text not null , updated_at text not null );

-- table: conversation_entries
create table conversation_entries ( id text primary key , session_id text not null , request_id text not null , kind text not null , timestamp text not null , sequence integer not null , data text not null , foreign key ( session_id ) references sessions ( id ) on delete cascade );

-- table: run_events
create table run_events ( id integer primary key autoincrement , session_id text not null , request_id text not null , kind text not null , timestamp text not null , event_sequence integer not null , step integer , detail_id text , event_json text not null , foreign key ( session_id ) references sessions ( id ) on delete cascade );

-- table: run_snapshots
create table run_snapshots ( session_id text not null , request_id text not null , input text not null , status text not null check ( status in ( 'running' , 'completed' , 'failed' , 'cancelled' ) ) , started_at text not null , updated_at text not null , ended_at text , error_message text , model_provider text , primary key ( session_id , request_id ) , foreign key ( session_id ) references sessions ( id ) on delete cascade );

-- table: sessions
create table sessions ( id text primary key , title text not null default '新对话' , status text not null default 'idle' , created_at text not null , updated_at text not null , active_request_id text , metadata text not null default '{}' );

-- table: step_traces
create table step_traces ( session_id text not null , request_id text not null , turn_sequence integer not null , step integer not null , seq integer not null , data text not null , primary key ( session_id , request_id , step , seq ) , foreign key ( session_id ) references sessions ( id ) on delete cascade );

-- index: idx_entries_request
create index idx_entries_request on conversation_entries ( request_id );

-- index: idx_entries_session_seq
create index idx_entries_session_seq on conversation_entries ( session_id , sequence );

-- index: idx_run_events_request
create index idx_run_events_request on run_events ( request_id );

-- index: idx_run_events_session_id
create index idx_run_events_session_id on run_events ( session_id , id );

-- index: idx_run_snapshots_session
create index idx_run_snapshots_session on run_snapshots ( session_id , started_at );

-- index: idx_sessions_updated
create index idx_sessions_updated on sessions ( updated_at desc );

-- index: idx_step_traces_session
create index idx_step_traces_session on step_traces ( session_id , turn_sequence , step , seq );
