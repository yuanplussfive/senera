-- table: resource_id_reservations
create table resource_id_reservations ( resource_id text primary key not null , owner_key text unique , allocated_at text not null ) strict;
