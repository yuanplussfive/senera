-- table: app_settings
create table app_settings ( key text primary key , value text not null , updated_at text not null );

-- table: conversation_entries
create table "conversation_entries" ( session_id text not null , id text not null , request_id text not null , kind text not null , timestamp text not null , sequence integer not null , data text not null , primary key ( session_id , id ) , unique ( session_id , sequence ) , foreign key ( session_id ) references sessions ( id ) on delete cascade );

-- table: event_outbox
create table event_outbox ( event_id text primary key , session_id text not null , request_id text not null , kind text not null , timestamp text not null , event_sequence integer not null , step integer , detail_id text , event_json text not null , state text not null check ( state in ( 'pending' , 'committed' , 'failed' ) ) , attempts integer not null default 0 , next_attempt_at text , last_error text , created_at text not null , committed_at text , foreign key ( session_id ) references sessions ( id ) on delete cascade );

-- table: run_events
create table run_events ( id integer primary key autoincrement , session_id text not null , request_id text not null , kind text not null , timestamp text not null , event_sequence integer not null , step integer , detail_id text , event_json text not null , event_id text , reliability text not null default 'durable' , foreign key ( session_id ) references sessions ( id ) on delete cascade );

-- table: run_snapshots
create table run_snapshots ( session_id text not null , request_id text not null , input text not null , status text not null check ( status in ( 'running' , 'completed' , 'failed' , 'cancelled' ) ) , started_at text not null , updated_at text not null , ended_at text , error_message text , model_provider text , primary key ( session_id , request_id ) , foreign key ( session_id ) references sessions ( id ) on delete cascade );

-- table: session_commands
create table session_commands ( session_id text not null , command_id text not null , operation_kind text not null , payload_hash text not null , request_id text not null , state text not null check ( state in ( 'running' , 'completed' , 'failed' , 'cancelled' ) ) , created_at text not null , updated_at text not null , primary key ( session_id , command_id ) , foreign key ( session_id ) references sessions ( id ) on delete cascade );

-- table: session_fork_mutations
create table session_fork_mutations ( target_session_id text primary key , mutation_id text not null unique , source_session_id text not null references sessions ( id ) on delete cascade , through_request_id text not null , pi_kind text not null check ( pi_kind in ( 'none' , 'fork' ) ) , pi_entry_id text , model_provider_id text , created_at text not null , check ( ( pi_kind = 'fork' and pi_entry_id is not null ) or ( pi_kind = 'none' and pi_entry_id is null ) ) );

-- table: session_history_mutations
create table session_history_mutations ( session_id text primary key references sessions ( id ) on delete cascade , mutation_id text not null unique , kind text not null check ( kind = 'truncate' ) , from_request_id text not null , pi_kind text not null check ( pi_kind in ( 'none' , 'reset' , 'rewind' ) ) , pi_entry_id text , model_provider_id text , created_at text not null , check ( ( pi_kind = 'rewind' and pi_entry_id is not null ) or ( pi_kind != 'rewind' and pi_entry_id is null ) ) );

-- table: sessions
create table sessions ( id text primary key , title text not null default '新对话' , status text not null default 'idle' , created_at text not null , updated_at text not null , active_request_id text , metadata text not null default '{}' );

-- table: step_traces
create table step_traces ( session_id text not null , request_id text not null , turn_sequence integer not null , step integer not null , seq integer not null , data text not null , primary key ( session_id , request_id , step , seq ) , foreign key ( session_id ) references sessions ( id ) on delete cascade );

-- table: turn_preparations
create table turn_preparations ( session_id text not null , request_id text not null , snapshot_json text not null , created_at text not null , primary key ( session_id , request_id ) , foreign key ( session_id ) references sessions ( id ) on delete cascade );

-- index: idx_entries_session_request
create index idx_entries_session_request on conversation_entries ( session_id , request_id );

-- index: idx_event_outbox_committed_retention
create index idx_event_outbox_committed_retention on event_outbox ( state , committed_at );

-- index: idx_event_outbox_pending
create index idx_event_outbox_pending on event_outbox ( state , next_attempt_at , created_at );

-- index: idx_event_outbox_session
create index idx_event_outbox_session on event_outbox ( session_id , created_at );

-- index: idx_run_events_event_id
create unique index idx_run_events_event_id on run_events ( event_id );

-- index: idx_run_events_request
create index idx_run_events_request on run_events ( request_id );

-- index: idx_run_events_session_id
create index idx_run_events_session_id on run_events ( session_id , id );

-- index: idx_run_events_session_request_id
create index idx_run_events_session_request_id on run_events ( session_id , request_id , id );

-- index: idx_run_snapshots_session
create index idx_run_snapshots_session on run_snapshots ( session_id , started_at );

-- index: idx_session_commands_request
create index idx_session_commands_request on session_commands ( session_id , request_id );

-- index: idx_session_fork_mutations_source
create index idx_session_fork_mutations_source on session_fork_mutations ( source_session_id , created_at );

-- index: idx_sessions_updated
create index idx_sessions_updated on sessions ( updated_at desc );

-- index: idx_step_traces_session
create index idx_step_traces_session on step_traces ( session_id , turn_sequence , step , seq );

-- index: idx_turn_preparations_session
create index idx_turn_preparations_session on turn_preparations ( session_id , created_at );
