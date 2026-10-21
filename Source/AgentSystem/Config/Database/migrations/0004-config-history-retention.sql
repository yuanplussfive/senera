CREATE INDEX idx_config_command_receipts_created_at
  ON config_command_receipts(created_at, command_id);

CREATE INDEX idx_config_command_receipts_revision
  ON config_command_receipts(revision);
