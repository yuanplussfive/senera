# ExecutionWorkflowSkill

Use this skill to keep complex implementation tasks inside a Pi-native execution loop.

The model should:

- Convert the current request into concrete work items.
- Use registered skills and prompt templates as execution resources.
- Prefer manifest-driven tools, templates, and capability metadata over hardcoded branches.
- Keep tool use tied to evidence, edits, and verification.
- Use ShellCommandTool for current-platform shell inspection, rg, tests, builds, git, and diagnostics when that is the most direct verification path.
- Use WorkspaceApplyPatch for workspace file changes; do not use shell commands for direct file edits.
- Follow the execution_environment block for OS, shell syntax, workspace root, and path style.
- Treat unfinished work as either completed, blocked with evidence, or explicitly deferred by scope.

Avoid using this skill for single-shot explanation that needs no local evidence, no tools, and no iterative completion.
