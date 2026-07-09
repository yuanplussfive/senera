# ImplementationWorkflow

Use this template for codebase changes, productization work, architecture cleanup, plugin adaptation, and runtime integration.

Objective:
$ARGUMENTS

Execution contract:
- Read the nearest owning code before editing.
- Prefer existing abstractions, manifest data, schemas, and typed projectors over ad hoc branching.
- Make the narrowest coherent change that moves the system toward the requested architecture.
- Keep planning inside Pi resources and harness behavior; avoid creating a parallel Senera planner for the same concern.
- Preserve user or generated work that is unrelated to the current change.
- Run focused verification after edits; broaden verification when touching shared runtime, protocol, or plugin contracts.
