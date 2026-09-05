-- table: agent_workflow_nodes
create table agent_workflow_nodes ( workflow_id text not null references agent_workflows ( id ) on delete cascade , node_id text not null check ( length ( trim ( node_id ) ) > 0 ) , status text not null check ( status in ( 'pending' , 'running' , 'paused' , 'completed' , 'partial_completed' , 'failed' , 'skipped' , 'cancelled' ) ) , child_run_id text references child_runs ( id ) on delete set null , error text , created_at text not null , started_at text , completed_at text , updated_at text not null , revision integer not null default 1 check ( revision > 0 ) , primary key ( workflow_id , node_id ) );

-- table: agent_workflows
create table agent_workflows ( id text primary key check ( length ( trim ( id ) ) > 0 ) , parent_session_id text not null check ( length ( trim ( parent_session_id ) ) > 0 ) , parent_request_id text not null check ( length ( trim ( parent_request_id ) ) > 0 ) , approval_mode text not null check ( approval_mode in ( 'always_ask' , 'agent' , 'full_access' ) ) , status text not null check ( status in ( 'queued' , 'running' , 'paused' , 'completed' , 'partial_completed' , 'failed' , 'cancelling' , 'cancelled' ) ) , definition_digest text not null check ( length ( trim ( definition_digest ) ) > 0 ) , definition_json text not null check ( json_valid ( definition_json ) ) , error text , created_at text not null , started_at text , completed_at text , updated_at text not null , revision integer not null default 1 check ( revision > 0 ) );

-- table: child_run_completion_deliveries
create table child_run_completion_deliveries ( id text primary key check ( length ( trim ( id ) ) > 0 ) , child_run_id text not null references child_runs ( id ) on delete cascade , port_id text not null check ( length ( trim ( port_id ) ) > 0 ) , delivery_status text not null check ( delivery_status in ( 'pending' , 'claimed' , 'delivered' , 'dropped' ) ) , attempt integer not null default 0 check ( attempt >= 0 ) , available_at text not null , claim_id text , claim_until text , last_error text , created_at text not null , updated_at text not null , delivered_at text , unique ( child_run_id , port_id ) );

-- table: child_run_messages
create table "child_run_messages" ( sequence integer primary key autoincrement , id text not null unique check ( length ( trim ( id ) ) > 0 ) , child_run_id text not null references child_runs ( id ) on delete cascade , direction text not null check ( direction in ( 'child_to_parent' , 'parent_to_child' ) ) , kind text not null check ( kind in ( 'decision' , 'follow_up' , 'progress' , 'response' , 'steering' ) ) , content text not null check ( length ( trim ( content ) ) > 0 ) , created_at text not null );

-- table: child_runs
create table "child_runs" ( id text primary key check ( length ( trim ( id ) ) > 0 ) , owner_run_id text not null check ( length ( trim ( owner_run_id ) ) > 0 ) , node_id text not null check ( length ( trim ( node_id ) ) > 0 ) , parent_session_id text not null check ( length ( trim ( parent_session_id ) ) > 0 ) , parent_request_id text not null check ( length ( trim ( parent_request_id ) ) > 0 ) , child_session_id text not null unique check ( length ( trim ( child_session_id ) ) > 0 ) , child_request_id text not null unique check ( length ( trim ( child_request_id ) ) > 0 ) , agent_name text not null check ( length ( trim ( agent_name ) ) > 0 ) , task text not null check ( length ( trim ( task ) ) > 0 ) , context_mode text not null check ( context_mode in ( 'fresh' , 'fork' ) ) , approval_mode text not null check ( approval_mode in ( 'always_ask' , 'agent' , 'full_access' ) ) , model_provider_id text , status text not null check ( status in ( 'queued' , 'running' , 'wrapping_up' , 'cancelling' , 'awaiting_supervisor' , 'completed' , 'partial_completed' , 'interrupted' , 'timed_out' , 'failed' , 'cancelled' ) ) , launch_contract_digest text not null check ( length ( trim ( launch_contract_digest ) ) > 0 ) , launch_contract_json text not null check ( json_valid ( launch_contract_json ) ) , allowed_tool_names_json text not null check ( json_valid ( allowed_tool_names_json ) ) , snapshot_json text check ( snapshot_json is null or json_valid ( snapshot_json ) ) , checkpoint_json text check ( checkpoint_json is null or json_valid ( checkpoint_json ) ) , final_answer text , usage_json text check ( usage_json is null or json_valid ( usage_json ) ) , error text , created_at text not null , started_at text , completed_at text , updated_at text not null , revision integer not null default 1 check ( revision > 0 ) , model_selection_source text check ( model_selection_source is null or model_selection_source in ( 'request' , 'extension_default' , 'role' , 'parent' , 'runtime_default' ) ) , selected_skills_json text not null default '[]' check ( json_valid ( selected_skills_json ) ) , configuration_revision integer check ( configuration_revision is null or configuration_revision >= 0 ) , execution_contract_json text not null check ( json_valid ( execution_contract_json ) ) , unique ( owner_run_id , node_id ) );

-- table: scheduled_task_runs
create table scheduled_task_runs ( id text primary key check ( length ( trim ( id ) ) > 0 ) , task_id text not null references scheduled_tasks ( id ) on delete cascade , scheduled_for text not null , execution_status text not null check ( execution_status in ( 'queued' , 'claimed' , 'running' , 'succeeded' , 'failed' ) ) , delivery_status text not null check ( delivery_status in ( 'pending' , 'delivered' , 'not_required' ) ) , execution_session_id text not null check ( length ( trim ( execution_session_id ) ) > 0 ) , claim_id text , claim_until text , attempt integer not null default 0 check ( attempt >= 0 ) , result text , error text , delivery_claim_id text , delivery_claim_until text , delivery_attempt integer not null default 0 check ( delivery_attempt >= 0 ) , delivery_error text , created_at text not null , started_at text , completed_at text , delivered_at text , updated_at text not null , source_request_id text , deliver_at text , unique ( task_id , scheduled_for ) );

-- table: scheduled_task_tool_policies
create table scheduled_task_tool_policies ( task_id text primary key references scheduled_tasks ( id ) on delete cascade , allowed_tool_names_json text not null check ( json_valid ( allowed_tool_names_json ) ) , updated_at text not null );

-- table: scheduled_tasks
create table scheduled_tasks ( id text primary key check ( length ( trim ( id ) ) > 0 ) , tenant_id text , user_id text , workspace_id text , session_id text not null check ( length ( trim ( session_id ) ) > 0 ) , name text , description text , prompt text not null check ( length ( trim ( prompt ) ) > 0 ) , task_type text not null check ( task_type in ( 'cron' , 'once' , 'interval' ) ) , schedule_expression text not null check ( length ( trim ( schedule_expression ) ) > 0 ) , interval_seconds integer not null check ( interval_seconds >= 0 ) , enabled integer not null check ( enabled in ( 0 , 1 ) ) , model_provider text not null check ( length ( trim ( model_provider ) ) > 0 ) , model_id text not null check ( length ( trim ( model_id ) ) > 0 ) , thinking_level text check ( thinking_level is null or thinking_level in ( 'off' , 'minimal' , 'low' , 'medium' , 'high' , 'xhigh' ) ) , auth_profile_id text , reasoning integer check ( reasoning is null or reasoning in ( 0 , 1 ) ) , tool_policy_profile text not null check ( length ( trim ( tool_policy_profile ) ) > 0 ) , workspace_dir text , created_at text not null , updated_at text not null , last_run_at text , next_run_at text , run_count integer not null check ( run_count >= 0 ) , timeout_ms integer check ( timeout_ms is null or timeout_ms > 0 ) , last_status text check ( last_status is null or last_status in ( 'success' , 'error' , 'running' ) ) , last_error text , revision integer not null default 1 check ( revision > 0 ) , source_request_id text , execution_mode text not null default 'at_due_time' check ( execution_mode in ( 'at_due_time' , 'execute_now_deliver_at' ) ) );

-- index: agent_workflow_nodes_child_run_idx
create index agent_workflow_nodes_child_run_idx on agent_workflow_nodes ( child_run_id );

-- index: agent_workflow_nodes_status_idx
create index agent_workflow_nodes_status_idx on agent_workflow_nodes ( workflow_id , status , updated_at );

-- index: agent_workflows_parent_idx
create index agent_workflows_parent_idx on agent_workflows ( parent_session_id , parent_request_id , created_at desc );

-- index: agent_workflows_status_idx
create index agent_workflows_status_idx on agent_workflows ( status , updated_at );

-- index: child_run_completion_deliveries_due_idx
create index child_run_completion_deliveries_due_idx on child_run_completion_deliveries ( port_id , delivery_status , available_at , claim_until , created_at );

-- index: child_run_completion_deliveries_run_idx
create index child_run_completion_deliveries_run_idx on child_run_completion_deliveries ( child_run_id , port_id );

-- index: child_run_messages_run_idx
create index child_run_messages_run_idx on child_run_messages ( child_run_id , sequence );

-- index: child_runs_owner_node_idx
create index child_runs_owner_node_idx on child_runs ( owner_run_id , node_id );

-- index: child_runs_parent_idx
create index child_runs_parent_idx on child_runs ( parent_session_id , parent_request_id , created_at desc );

-- index: child_runs_status_idx
create index child_runs_status_idx on child_runs ( status , updated_at );

-- index: scheduled_task_runs_claim_idx
create index scheduled_task_runs_claim_idx on scheduled_task_runs ( execution_status , claim_until , scheduled_for );

-- index: scheduled_task_runs_delivery_idx
create index scheduled_task_runs_delivery_idx on scheduled_task_runs ( execution_status , delivery_status , deliver_at , delivery_claim_until , completed_at );

-- index: scheduled_task_runs_task_idx
create index scheduled_task_runs_task_idx on scheduled_task_runs ( task_id , created_at desc );

-- index: scheduled_tasks_due_idx
create index scheduled_tasks_due_idx on scheduled_tasks ( enabled , next_run_at );

-- index: scheduled_tasks_scope_idx
create index scheduled_tasks_scope_idx on scheduled_tasks ( tenant_id , user_id , updated_at desc );
