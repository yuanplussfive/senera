ALTER TABLE child_runs
  RENAME COLUMN result_consumed_at TO parent_result_delivered_at;

UPDATE child_runs
SET parent_result_delivered_at = updated_at
WHERE parent_result_delivered_at IS NULL AND parent_wake_consumed = 1;

ALTER TABLE child_runs
  DROP COLUMN parent_wake_consumed;
