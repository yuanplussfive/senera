-- table: channel_sessions
create table channel_sessions ( platform text not null check ( length ( trim ( platform ) ) > 0 ) , chat_type text not null check ( length ( trim ( chat_type ) ) > 0 ) , chat_id text not null check ( length ( trim ( chat_id ) ) > 0 ) , user_id text not null , thread_id text , session_id text not null check ( length ( trim ( session_id ) ) > 0 ) , epoch integer not null default 1 check ( epoch >= 1 ) , created_at text not null , updated_at text not null , primary key ( platform , chat_type , chat_id , user_id , thread_id ) );

-- index: channel_sessions_session_idx
create index channel_sessions_session_idx on channel_sessions ( session_id );

-- index: channel_sessions_updated_idx
create index channel_sessions_updated_idx on channel_sessions ( updated_at );
