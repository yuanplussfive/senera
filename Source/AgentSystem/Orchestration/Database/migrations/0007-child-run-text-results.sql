UPDATE child_runs
SET execution_contract_json = json_remove(
  json_set(execution_contract_json, '$.version', 4),
  '$.outputSchema'
)
WHERE json_extract(execution_contract_json, '$.version') = 3;

ALTER TABLE child_runs DROP COLUMN structured_result_json;
