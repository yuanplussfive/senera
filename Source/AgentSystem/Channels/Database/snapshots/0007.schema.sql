-- table: channel_conversation_decisions
create table channel_conversation_decisions ( session_id text not null references channel_participants ( session_id ) on delete cascade , call_id text not null , result text not null , primary key ( session_id , call_id ) );

-- table: channel_conversation_dispositions
create table channel_conversation_dispositions ( session_id text not null references channel_participants ( session_id ) on delete cascade , sequence integer not null references channel_events ( sequence ) on delete cascade , task_id text references channel_conversation_tasks ( id ) on delete cascade , disposition text not null check ( disposition in ( 'request' , 'supplement' , 'ambient' ) ) , primary key ( session_id , sequence ) );

-- table: channel_conversation_tasks
create table channel_conversation_tasks ( id text primary key , session_id text not null references channel_participants ( session_id ) on delete cascade , title text not null , status text not null check ( status in ( 'pending' , 'active' , 'waiting' , 'completed' , 'cancelled' ) ) , owner_id text not null , participant_ids text not null , next_action text , wake_at text , created_sequence integer not null references channel_events ( sequence ) on delete cascade , updated_sequence integer not null , revision integer not null default 1 , created_by text not null , unique ( session_id , created_by ) );

-- table: channel_event_tasks
create table channel_event_tasks ( sequence integer not null references channel_events ( sequence ) on delete cascade , session_id text not null , request_id text not null , primary key ( sequence , session_id ) );

-- table: channel_events
create table channel_events ( sequence integer primary key autoincrement , conversation text not null , event_key text not null , payload text not null check ( json_valid ( payload ) ) , unique ( conversation , event_key ) );

-- table: channel_ingress
create table channel_ingress ( sequence integer primary key autoincrement , id text not null unique , platform text not null , state text not null check ( state in ( 'pending' , 'accepted' , 'failed' , 'discarded' ) ) , payload text not null check ( json_valid ( payload ) ) );

-- table: channel_outbox
create table channel_outbox ( sequence integer primary key autoincrement , id text not null unique , platform text not null , lane text not null , state text not null check ( state in ( 'pending' , 'sending' , 'sent' , 'failed' , 'uncertain' ) ) , digest text not null , payload text not null check ( json_valid ( payload ) ) );

-- table: channel_participants
create table channel_participants ( session_id text primary key , conversation text not null , source text not null check ( json_valid ( source ) ) , cursor integer not null default 0 check ( cursor >= 0 ) , trigger_sequence integer not null default 0 check ( trigger_sequence >= 0 ) , pending_sequence integer , resume_request_id text , active_request_id text , status text not null check ( status in ( 'active' , 'waiting' , 'ready' , 'paused' ) ) , wait_id text , request_id text , conditions text check ( conditions is null or json_valid ( conditions ) ) , wake_at text , wake_reason text check ( wake_reason is null or wake_reason in ( 'event' , 'time' ) ) , actor text check ( actor is null or json_valid ( actor ) ) , scheduled_revision integer check ( scheduled_revision is null or scheduled_revision > 0 ) );

-- table: channel_sessions
create table "channel_sessions" ( platform text not null check ( length ( trim ( platform ) ) > 0 ) , chat_type text not null check ( length ( trim ( chat_type ) ) > 0 ) , chat_id text not null check ( length ( trim ( chat_id ) ) > 0 ) , user_id text not null , agent_id text not null default '' , thread_id text not null default '' , session_id text not null check ( length ( trim ( session_id ) ) > 0 ) , epoch integer not null default 1 check ( epoch >= 1 ) , created_at text not null , updated_at text not null , primary key ( platform , chat_type , chat_id , user_id , agent_id , thread_id ) );

-- table: channel_task_evaluations
create table channel_task_evaluations ( task_id text not null references channel_conversation_tasks ( id ) on delete cascade , revision integer not null , request_id text not null , primary key ( task_id , revision ) );

-- table: interaction_identity_bindings
create table interaction_identity_bindings ( authority text not null , account text not null , principal_id text not null references interaction_principals ( id ) , primary key ( authority , account ) );

-- table: interaction_legacy_subjects
create table interaction_legacy_subjects ( subject_id text primary key , principal_id text not null references interaction_principals ( id ) );

-- table: interaction_principals
create table interaction_principals ( id text primary key , reference text not null unique , kind text not null check ( kind in ( 'user' , 'agent' ) ) );

-- index: channel_conversation_tasks_pending
create index channel_conversation_tasks_pending on channel_conversation_tasks ( session_id , status , created_sequence );

-- index: channel_event_tasks_run_idx
create index channel_event_tasks_run_idx on channel_event_tasks ( session_id , request_id );

-- index: channel_events_conversation_idx
create index channel_events_conversation_idx on channel_events ( conversation , sequence );

-- index: channel_participants_conversation_idx
create index channel_participants_conversation_idx on channel_participants ( conversation );

-- index: channel_participants_wake_idx
create index channel_participants_wake_idx on channel_participants ( status , wake_at );

-- index: channel_sessions_session_idx
create index channel_sessions_session_idx on channel_sessions ( session_id );

-- index: channel_sessions_updated_idx
create index channel_sessions_updated_idx on channel_sessions ( updated_at );

-- index: idx_channel_ingress_pending
create index idx_channel_ingress_pending on channel_ingress ( platform , state , sequence );

-- index: idx_channel_outbox_pending
create index idx_channel_outbox_pending on channel_outbox ( platform , state , sequence );
