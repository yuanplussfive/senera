UPDATE child_runs
SET execution_contract_json = json_remove(
  json_set(
    execution_contract_json,
    '$.deadline.activityExtension.recentActivityWindowMs',
    json_extract(execution_contract_json, '$.deadline.activityExtension.recentModelOutputWindowMs')
  ),
  '$.deadline.activityExtension.recentModelOutputWindowMs'
)
WHERE json_type(
  execution_contract_json,
  '$.deadline.activityExtension.recentModelOutputWindowMs'
) IS NOT NULL;
