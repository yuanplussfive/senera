-- table: resource_id_reservations
create table resource_id_reservations ( resource_id text primary key not null , owner_key text unique , allocated_at text not null ) strict;

-- table: resource_records
create table resource_records ( resource_id text primary key not null references resource_id_reservations ( resource_id ) , kind text not null check ( kind in ( 'artifact' , 'file' ) ) , entity_id text not null , locator text not null , state text not null check ( state in ( 'pending' , 'ready' , 'deleted' ) ) , unique ( kind , entity_id ) ) strict;

-- table: resource_uri_aliases
create table resource_uri_aliases ( alias text primary key not null , resource_id text not null references resource_records ( resource_id ) ) strict;
