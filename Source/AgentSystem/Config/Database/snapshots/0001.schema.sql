-- table: config_metadata
create table config_metadata ( key text primary key , value text not null );

-- table: config_revisions
create table config_revisions ( revision integer primary key , config_json text not null , source text not null , created_at text not null ) strict;
