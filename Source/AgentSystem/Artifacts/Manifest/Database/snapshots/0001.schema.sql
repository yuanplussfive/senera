-- table: artifact_manifest_assets
create table artifact_manifest_assets ( artifact_root text not null , resource_uri text not null , artifact_id text not null , file_name text not null , media_type text not null , relative_path text not null , byte_length integer not null , sha256 text not null , primary key ( artifact_root , resource_uri ) , foreign key ( artifact_root , artifact_id ) references artifact_manifest_index ( artifact_root , artifact_id ) on delete cascade ) strict;

-- table: artifact_manifest_index
create table artifact_manifest_index ( artifact_root text not null , artifact_id text not null , artifact_uri text not null , manifest_path text not null , relative_dir text not null , fingerprint_size integer not null , fingerprint_mtime_ms real not null , fingerprint_ctime_ms real not null , fingerprint_ino integer not null , status text not null check ( status in ( 'valid' , 'invalid' ) ) , error_message text , checkpoint_id text , checkpoint_captured_at text , scan_generation text not null , primary key ( artifact_root , artifact_id ) , unique ( artifact_root , manifest_path ) , check ( ( status = 'valid' and error_message is null ) or ( status = 'invalid' and error_message is not null ) ) ) strict;

-- table: artifact_manifest_invalid
create table artifact_manifest_invalid ( artifact_root text not null , manifest_path text not null , fingerprint_size integer not null , fingerprint_mtime_ms real not null , fingerprint_ctime_ms real not null , fingerprint_ino integer not null , error_message text not null , scan_generation text not null , primary key ( artifact_root , manifest_path ) ) strict;

-- index: artifact_manifest_assets_artifact
create index artifact_manifest_assets_artifact on artifact_manifest_assets ( artifact_root , artifact_id );

-- index: artifact_manifest_index_checkpoint
create index artifact_manifest_index_checkpoint on artifact_manifest_index ( artifact_root , checkpoint_id , checkpoint_captured_at );
