-- table: config_command_receipts
create table config_command_receipts ( command_id text primary key , operation_kind text not null , payload_hash text not null , revision integer not null references config_revisions ( revision ) , created_at text not null ) strict;

-- table: config_revisions
create table config_revisions ( revision integer primary key , config_json text not null , source text not null , created_at text not null ) strict;

-- index: idx_config_command_receipts_created_at
create index idx_config_command_receipts_created_at on config_command_receipts ( created_at , command_id );

-- index: idx_config_command_receipts_revision
create index idx_config_command_receipts_revision on config_command_receipts ( revision );
