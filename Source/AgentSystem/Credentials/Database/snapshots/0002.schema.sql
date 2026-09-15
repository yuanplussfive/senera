-- table: mcp_credential_state
create table mcp_credential_state ( singleton integer primary key check ( singleton = 1 ) , revision integer not null check ( revision >= 0 ) );

-- table: mcp_credentials
create table mcp_credentials ( server_id text not null check ( length ( trim ( server_id ) ) > 0 ) , name text not null check ( length ( trim ( name ) ) > 0 ) , value_envelope text not null check ( length ( value_envelope ) > 0 ) , created_at text not null , updated_at text not null , primary key ( server_id , name ) );

-- table: mcp_input_state
create table mcp_input_state ( singleton integer primary key check ( singleton = 1 ) , revision integer not null check ( revision >= 0 ) );

-- table: mcp_input_values
create table mcp_input_values ( server_id text not null check ( length ( trim ( server_id ) ) > 0 ) , input_id text not null check ( length ( trim ( input_id ) ) > 0 ) , value_json text not null check ( json_valid ( value_json ) ) , created_at text not null , updated_at text not null , primary key ( server_id , input_id ) );
