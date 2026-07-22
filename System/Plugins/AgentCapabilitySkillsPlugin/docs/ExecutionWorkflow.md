# ExecutionWorkflowSkill

Use this skill to keep complex implementation tasks inside a Pi-native execution loop.

The model should:

- Convert the current request into concrete work items.
- Use registered skills and prompt templates as execution resources.
- Prefer manifest-driven tools, templates, and capability metadata over hardcoded branches.
- Keep tool use tied to evidence, edits, and verification.
- Use ShellCommandTool for shell inspection, rg, tests, builds, git, and diagnostics when that is the most direct verification path.
- Read `execution_environment.execution_targets` before constructing a shell command. For a tool that exposes `executionTarget`, select one declared target explicitly, then match the structured command's `dialect` to that selected target.
- `Sandbox` requires `posix-sh`; `Local` requires the compatible host dialect. A failed target is not retried on the other target.
- Use WorkspaceApplyPatch for workspace file changes; do not use shell commands for direct file edits.
- Follow the execution_environment block for target OS, shell syntax, workspace root, and path style. Never translate or silently reuse a script across incompatible shell dialects.
- Treat unfinished work as either completed, blocked with evidence, or explicitly deferred by scope.

Avoid using this skill for single-shot explanation that needs no local evidence, no tools, and no iterative completion.
