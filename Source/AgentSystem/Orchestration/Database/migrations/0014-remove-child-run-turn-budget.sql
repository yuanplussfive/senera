UPDATE child_runs
SET execution_contract_json = json_remove(execution_contract_json, '$.turnBudget')
WHERE json_type(execution_contract_json, '$.turnBudget') IS NOT NULL;
