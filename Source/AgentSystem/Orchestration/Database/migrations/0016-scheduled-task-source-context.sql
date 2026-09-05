ALTER TABLE scheduled_tasks ADD COLUMN source_request_id TEXT;

ALTER TABLE scheduled_task_runs ADD COLUMN source_request_id TEXT;
