UPDATE child_runs
SET execution_contract_json = json_set(
  execution_contract_json,
  '$.version', 2,
  '$.timeoutMs', 900000
);
