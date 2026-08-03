---
name: execution-workflow
description: Execute multi-step code changes, bug fixes, refactors, architecture cleanup, productization, runtime integration, or continue-until-done tasks with a tracked plan and deterministic verification. Use when work requires reading a repository, editing files, running tests or builds, and closing every requested outcome with evidence. 适用于全面优化、拓展、重构、修复问题、修改代码、运行测试或要求持续执行直到完成的任务。
---

# Execution Workflow

1. Translate the request into outcome-oriented work items and order dependencies.
2. Read the nearest owning code and repository instructions before editing.
3. Prefer existing typed abstractions, schemas, and projectors over parallel implementations.
4. Add or identify a focused check before implementation when a suitable test path exists.
5. Apply workspace edits with the patch tool and preserve unrelated work.
6. Run the narrowest useful verification first; broaden checks for shared runtime or protocol changes.
7. Revise the work items when evidence changes the plan.
8. Finish only when every item is completed, blocked with evidence, or explicitly outside scope.

Use ToolSearch to discover repository, patch, shell, and verification tools when they are not already visible.
