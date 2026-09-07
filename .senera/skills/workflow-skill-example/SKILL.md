---
name: workflow-skill-example
description: Reference example for a prompt-only workflow Skill that reviews a proposed code change using existing workspace tools. Use as a creation pattern, not as a general-purpose user workflow.
metadata:
  senera:
    recommended-tools:
      - ShellCommandTool
---

# Change Review Workflow Example

1. Use `ShellCommandTool` with focused `rg` or file-read commands to locate the affected symbols and their consumers.
2. Use `ShellCommandTool` to inspect the implementation, contracts, and focused tests.
3. Identify behavioral regressions, missing validation, and untested boundaries.
4. Report findings by severity with concrete file references.

This Workflow Skill composes existing registered tools. It does not create scripts or register a new tool.
