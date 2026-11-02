-- table: entity_reference_aliases
create table entity_reference_aliases ( domain text not null , alias text not null , reference text not null , primary key ( domain , alias ) , foreign key ( domain , reference ) references entity_references ( domain , reference ) ) strict;

-- table: entity_references
create table entity_references ( domain text not null , reference text not null , entity_id text not null , primary key ( domain , reference ) , unique ( domain , entity_id ) ) strict;
