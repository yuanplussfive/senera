-- table: mcp_credential_state
create table mcp_credential_state ( singleton integer primary key check ( singleton = 1 ) , revision integer not null check ( revision >= 0 ) );

-- table: mcp_credentials
create table mcp_credentials ( server_id text not null check ( length ( trim ( server_id ) ) > 0 ) , name text not null check ( length ( trim ( name ) ) > 0 ) , value_envelope text not null check ( length ( value_envelope ) > 0 ) , created_at text not null , updated_at text not null , primary key ( server_id , name ) );
