-- table: workspace_observer_files
create table workspace_observer_files ( path_key text primary key , path text not null , kind text not null check ( kind in ( 'file' , 'directory' ) ) , size integer not null , mtime_ms real not null , hash text not null , content_state text not null check ( content_state in ( 'captured' , 'omitted' ) ) , content_reason text , content_ref text , content_byte_length integer , line_count integer , scan_generation text not null default '' , check ( ( content_state = 'captured' and content_reason is null and content_ref is not null and line_count is not null ) or ( content_state = 'omitted' and content_ref is null and line_count is null ) ) ) without rowid , strict;

-- index: idx_workspace_observer_files_path
create index idx_workspace_observer_files_path on workspace_observer_files ( path );

-- index: idx_workspace_observer_files_scan_generation
create index idx_workspace_observer_files_scan_generation on workspace_observer_files ( scan_generation );
