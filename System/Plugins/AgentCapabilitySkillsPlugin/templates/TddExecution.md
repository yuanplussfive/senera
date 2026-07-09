# TddExecution

Use this template when the user asks for a code change that can be verified with tests or deterministic checks.

Objective:
$ARGUMENTS

Execution contract:
- Restate the target behavior in one sentence.
- Prefer a failing or missing check before implementation when the repository already has a suitable test path.
- Make the smallest implementation change that satisfies the target behavior.
- Run the narrowest useful verification first, then broader checks only when the change affects shared behavior.
- Record unresolved blockers instead of claiming completion without evidence.
