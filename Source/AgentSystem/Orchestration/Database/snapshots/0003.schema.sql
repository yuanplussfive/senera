-- table: child_run_messages
create table child_run_messages ( id text primary key check ( length ( trim ( id ) ) > 0 ) , child_run_id text not null references child_runs ( id ) on delete cascade , direction text not null check ( direction in ( 'child_to_parent' , 'parent_to_child' ) ) , kind text not null check ( kind in ( 'decision' , 'progress' , 'response' , 'steering' ) ) , content text not null check ( length ( trim ( content ) ) > 0 ) , created_at text not null );

-- table: child_runs
create table "child_runs" ( id text primary key check ( length ( trim ( id ) ) > 0 ) , parent_session_id text not null check ( length ( trim ( parent_session_id ) ) > 0 ) , parent_request_id text not null check ( length ( trim ( parent_request_id ) ) > 0 ) , child_session_id text not null unique check ( length ( trim ( child_session_id ) ) > 0 ) , child_request_id text not null unique check ( length ( trim ( child_request_id ) ) > 0 ) , agent_name text not null check ( length ( trim ( agent_name ) ) > 0 ) , task text not null check ( length ( trim ( task ) ) > 0 ) , context_mode text not null check ( context_mode in ( 'fresh' , 'fork' ) ) , approval_mode text not null check ( approval_mode in ( 'always_ask' , 'agent' , 'full_access' ) ) , model_provider_id text , status text not null check ( status in ( 'queued' , 'running' , 'awaiting_supervisor' , 'completed' , 'failed' , 'cancelled' ) ) , launch_contract_digest text not null check ( length ( trim ( launch_contract_digest ) ) > 0 ) , launch_contract_json text not null check ( json_valid ( launch_contract_json ) ) , allowed_tool_names_json text not null check ( json_valid ( allowed_tool_names_json ) ) , final_answer text , usage_json text check ( usage_json is null or json_valid ( usage_json ) ) , error text , created_at text not null , started_at text , completed_at text , updated_at text not null , revision integer not null default 1 check ( revision > 0 ) , model_selection_source text check ( model_selection_source is null or model_selection_source in ( 'request' , 'extension_default' , 'role' , 'parent' , 'runtime_default' ) ) , selected_skills_json text not null default '[]' check ( json_valid ( selected_skills_json ) ) , configuration_revision integer check ( configuration_revision is null or configuration_revision >= 0 ) , execution_contract_json text not null check ( json_valid ( execution_contract_json ) ) );

-- table: scheduled_task_runs
create table scheduled_task_runs ( id text primary key check ( length ( trim ( id ) ) > 0 ) , task_id text not null references scheduled_tasks ( id ) on delete cascade , status text not null check ( status in ( 'success' , 'error' , 'running' , 'paused' , 'resumed' ) ) , session_id text , message text , created_at text not null , updated_at text not null );

-- table: scheduled_task_tool_policies
create table scheduled_task_tool_policies ( task_id text primary key references scheduled_tasks ( id ) on delete cascade , allowed_tool_names_json text not null check ( json_valid ( allowed_tool_names_json ) ) , updated_at text not null );

-- table: scheduled_tasks
create table scheduled_tasks ( id text primary key check ( length ( trim ( id ) ) > 0 ) , tenant_id text , user_id text , workspace_id text , session_id text not null check ( length ( trim ( session_id ) ) > 0 ) , name text , description text , prompt text not null check ( length ( trim ( prompt ) ) > 0 ) , task_type text not null check ( task_type in ( 'cron' , 'once' , 'interval' ) ) , schedule_expression text not null check ( length ( trim ( schedule_expression ) ) > 0 ) , interval_seconds integer not null check ( interval_seconds >= 0 ) , enabled integer not null check ( enabled in ( 0 , 1 ) ) , model_provider text not null check ( length ( trim ( model_provider ) ) > 0 ) , model_id text not null check ( length ( trim ( model_id ) ) > 0 ) , thinking_level text check ( thinking_level is null or thinking_level in ( 'off' , 'minimal' , 'low' , 'medium' , 'high' , 'xhigh' ) ) , auth_profile_id text , reasoning integer check ( reasoning is null or reasoning in ( 0 , 1 ) ) , tool_policy_profile text not null check ( length ( trim ( tool_policy_profile ) ) > 0 ) , workspace_dir text , created_at text not null , updated_at text not null , last_run_at text , next_run_at text , run_count integer not null check ( run_count >= 0 ) , timeout_ms integer check ( timeout_ms is null or timeout_ms > 0 ) , last_status text check ( last_status is null or last_status in ( 'success' , 'error' , 'running' ) ) , last_error text , revision integer not null default 1 check ( revision > 0 ) );

-- table: scheduler_leases
create table scheduler_leases ( name text primary key check ( length ( trim ( name ) ) > 0 ) , holder_id text not null check ( length ( trim ( holder_id ) ) > 0 ) , holder_pid integer not null check ( holder_pid > 0 ) , acquired_at_ms integer not null check ( acquired_at_ms >= 0 ) , lease_until_ms integer not null check ( lease_until_ms > acquired_at_ms ) , updated_at_ms integer not null check ( updated_at_ms >= acquired_at_ms ) , generation integer not null check ( generation > 0 ) );

-- index: child_run_messages_run_idx
create index child_run_messages_run_idx on child_run_messages ( child_run_id , created_at , id );

-- index: child_runs_parent_idx
create index child_runs_parent_idx on child_runs ( parent_session_id , parent_request_id , created_at desc );

-- index: child_runs_status_idx
create index child_runs_status_idx on child_runs ( status , updated_at );

-- index: scheduled_task_runs_task_idx
create index scheduled_task_runs_task_idx on scheduled_task_runs ( task_id , created_at desc );

-- index: scheduled_tasks_due_idx
create index scheduled_tasks_due_idx on scheduled_tasks ( enabled , next_run_at );

-- index: scheduled_tasks_scope_idx
create index scheduled_tasks_scope_idx on scheduled_tasks ( tenant_id , user_id , updated_at desc );
