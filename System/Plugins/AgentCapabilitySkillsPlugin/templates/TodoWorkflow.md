# TodoWorkflow

Use this template when the task spans multiple concrete steps, user-visible completion criteria, or "continue until done" execution.

Objective:
$ARGUMENTS

Execution contract:
- Maintain a private todo list for the current turn before choosing tools.
- Keep todo items outcome-oriented, not narration-oriented.
- Complete items in dependency order; revise the list when tool evidence changes the plan.
- Do not ask the user to do work that the available tools can complete safely.
- Before the final answer, verify that every todo item is done, blocked with evidence, or explicitly out of scope.
- Final answer should report completed work, verification, and remaining blockers only when they matter.
