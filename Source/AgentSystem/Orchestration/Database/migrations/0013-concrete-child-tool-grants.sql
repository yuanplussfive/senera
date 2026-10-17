UPDATE child_runs
SET launch_contract_json = json_set(
      launch_contract_json,
      '$.version',
      2,
      '$.role.canDelegate',
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM json_each(launch_contract_json, '$.tools.requestedPortableNames')
          WHERE value = 'subagent'
        ) THEN json('true')
        ELSE json('false')
      END,
      '$.tools',
      json_object(
        'effectiveToolNames',
        json(allowed_tool_names_json),
        'capabilityCeiling',
        json_object(
          'version',
          2,
          'allowedTools',
          json(allowed_tool_names_json),
          'allowedAgents',
          json(
            COALESCE(
              json_extract(execution_contract_json, '$.capabilityCeiling.allowedAgents'),
              json_extract(launch_contract_json, '$.tools.capabilityCeiling.allowedAgents'),
              '[]'
            )
          ),
          'denyExtensions',
          CASE
            WHEN COALESCE(
              json_extract(execution_contract_json, '$.capabilityCeiling.denyExtensions'),
              json_extract(launch_contract_json, '$.tools.capabilityCeiling.denyExtensions'),
              1
            ) <> 0 THEN json('true')
            ELSE json('false')
          END,
          'sources',
          json(
            COALESCE(
              json_extract(execution_contract_json, '$.capabilityCeiling.sources'),
              json_extract(launch_contract_json, '$.tools.capabilityCeiling.sources'),
              '["senera.migrated-child-run"]'
            )
          )
        )
      )
    ),
    execution_contract_json = json_set(
      execution_contract_json,
      '$.capabilityCeiling',
      json_object(
        'version',
        2,
        'allowedTools',
        json(allowed_tool_names_json),
        'allowedAgents',
        json(
          COALESCE(
            json_extract(execution_contract_json, '$.capabilityCeiling.allowedAgents'),
            json_extract(launch_contract_json, '$.tools.capabilityCeiling.allowedAgents'),
            '[]'
          )
        ),
        'denyExtensions',
        CASE
          WHEN COALESCE(
            json_extract(execution_contract_json, '$.capabilityCeiling.denyExtensions'),
            json_extract(launch_contract_json, '$.tools.capabilityCeiling.denyExtensions'),
            1
          ) <> 0 THEN json('true')
          ELSE json('false')
        END,
        'sources',
        json(
          COALESCE(
            json_extract(execution_contract_json, '$.capabilityCeiling.sources'),
            json_extract(launch_contract_json, '$.tools.capabilityCeiling.sources'),
            '["senera.migrated-child-run"]'
          )
        )
      )
    );
