---
name: json-field-selector
description: Select named fields from JSON objects or arrays. Use for deterministic field projection, especially when the input is stored in a workspace JSON file or the projection should be repeatable.
metadata:
  senera:
    recommended-tools:
      - ShellCommandTool
---

# JSON Field Selector

For small inline objects, project the requested fields directly.

For workspace JSON files or repeatable projection, run the bundled script with the existing `ShellCommandTool`:

```text
node .senera/skills/json-field-selector/scripts/select-fields.mjs <json-file> <field> [field...]
```

The script accepts one object or an array of objects and writes projected JSON to stdout. Preserve the requested field order and omit fields that are absent. Report invalid JSON or non-object input instead of guessing.

This package is a Toolkit Skill and does not register a native tool.

<!-- JSON_FIELD_SELECTOR_SKILL_EOF: This is the complete JSON Field Selector skill. -->
