---
name: agent-orchestration
description: Coordinate substantial work with subagent, send_message, list_agents and interrupt_agent. Manage background processes and scheduled follow-ups through the same durable session inbox. Use independent agents for bounded investigation, specialist work or parallel branches; handle simple requests directly. 适用于独立分工、后台任务和定时跟进。
---

# Agent orchestration

Use the smallest useful division of work. Assign an objective, boundaries and an expected result. Keep dependent decisions with the supervising agent and avoid duplicating delegated work.

## Plan when useful

Use `todo_write({todos: [{content, status}]})` for substantial multi-step work. Every call replaces the whole plan. Status is `pending`, `in_progress` or `completed`; an empty list clears it. Update phases when work moves, rather than marking several stale steps after the result arrives. Plans describe progress and do not gate successful completion. The host resets a previous plan for a new human request; completion notices and agent messages preserve it. Parallel in-progress steps follow the workspace policy.

When delegating a plan step, mark it `in_progress` first and pass its exact content as `subagent.todo`. The host links the stored task identity and completes the step only when every linked child succeeds. Failures and partial results keep it open for your decision. Keep your own acceptance or verification work in a separate step. Unchanged steps retain their identities across plan updates; removing a step or clearing the plan severs its old link. A late result never recreates an old step.

## Launch and communicate

Call `subagent` with a short `description` and a complete `prompt`. The published contract lists roles and resource claims. Give fresh agents the necessary objective, facts, constraints and expected deliverable. Use `forkContext` when the assignment benefits from the parent conversation; a fork inherits that conversation and should not receive a pasted copy of it. The host owns permissions and execution limits.

Declare known assignment paths in `resources` with the discovered path capability and actual read or write intent. These declarations reserve scheduling ownership and let the host inspect external access before launch. Paths outside the current workspace follow the same approval policy as ordinary Tools; they do not require switching workspaces. Approved scopes persist with the child and can only narrow through read-only roles. A claim alone does not authorize access. Treat an actual denial as a permission boundary and report its tool result rather than assuming every external path is forbidden. Workspace undo covers workspace paths; external patch changes are identified separately in the result.

Use `list_subagent_models` to discover the current authorized model pool. Filter by `provider_id`, exact `model_id` or required `capabilities`. It reports actual model declarations, context/output limits, reasoning levels, configured pricing when available, and delegation depth. Choose `subagent.modelProviderId` and optional `thinking` for the assignment using those facts and your judgment. The user's configured authorization permits autonomous selection; no separate approval is needed merely to choose an allowed model. Do not invent capabilities, cost or quality rankings from model names. Omit selections when the role/model default is suitable. Explicit unsupported choices fail rather than silently switching to another route or reasoning level.

At the depth limit, complete the assignment with your own tools. A child can send a concrete request to its direct parent if work needs reassignment. Do not try to evade depth, grants or resource ownership through another session or schedule.

The call returns a stable `agent_id`, this activation's `job_id`, and current `delivery` policy immediately. Model discovery and `job_list` also expose that policy. Check `delivery.can_wake_idle` before depending on automatic continuation; quiet mode or an exhausted wake budget requires an explicit wait when this task needs the result now. Use `agent_id` for messages and continuation, `job_id` for `job_output` or `job_kill`. Independent calls may share one native tool batch. Continue useful work while the children run. Keep `workItemId` stable when retrying the same assignment; use a new identity for intentionally separate work.

Use `send_message({agent_id, message})` with a direct parent or child. Its `message_id` acknowledges accepted input, not a reply. Active children receive steering at the Pi boundary; idle or restored children continue in their persisted session with a fresh activation budget. A child can obtain its parent identity from `list_agents`. Do not address unrelated agents or infer execution rights from an identity.

## Observe and finish

`list_agents` reports self, parent, children, actual state, current activation and result/error availability. Read a needed result with `job_output`; inventory does not repeat every child's full response. Progress includes the child's actual Todo when available, including the final plan after settlement. Tool counts or `model_output` only show activity: they do not prove a file was written or a check passed. Report concrete milestones from completed tool results, explicit child messages or its plan, and identify the source. Set `scope: "descendants"` to inspect the entire subtree in stable tree order, including each entry's direct parent and depth. Messaging still requires a direct relationship. Inventory does not acknowledge a completion notice. Do not repeatedly poll while nothing changes.

Final child responses are persisted and delivered through the same notification coordinator as process results. According to the configured policy, the host wakes an idle parent or saves a quiet notice for its next ordinary turn. Active parents receive a queued notice. Small results may be included directly; read larger results with `job_output`. A notice is host data rather than a new human request. Read and integrate the result; a failure or partial completion is not success. Send meaningful milestones or blockers with `send_message`, and finish with ordinary assistant text.

Use `interrupt_agent` when a descendant's current work is no longer needed. Only an ancestor can interrupt it, and interruption applies to that target only. Its queued, unconsumed messages remain parked until explicit `send_message` continuation. Other descendants continue independently. An accepted request can remain `cancelling` until execution settles. Resource and activation limits are explicit failures; do not bypass them by renaming assignments.

## Background jobs

Start a background shell process with `ShellCommandTool` and `timeoutMs: 0`. `job_list`, `job_output` and `job_kill` manage session-owned commands, PTYs and child-agent activations. When independent work remains, keep working. When only results remain, end the turn if `delivery.can_wake_idle` is true, leaving a concise pending-work update rather than claiming completion. Otherwise use `job_output({job_id, wait: true, timeout_ms: null})`: one event-driven wait reserves the jobs maximum, ending as soon as the producer settles or a human steers. Numeric `timeout_ms` requests a shorter bounded read; omission uses the jobs default. Do not repeat short waits to keep checking unchanged activity. Human steering ends the wait promptly, and cancelling or timing out a read leaves the producer running. The returned delivery policy reports the effective jobs limits; process-output collection limits do not govern this wait.

Process output uses explicit, independent cursors. Agent jobs return their activation's progress, result and error; resuming an agent does not replace older activation results. Stopping an old `job_id` never interrupts newer work. A terminal `job_output` or successful `job_kill` acknowledges its completion notice only after the tool result is committed to the conversation. Cancelled reads do not lose results. Inventory reads and independent observers do not acknowledge notices. Inspect `historyTruncated` and the oldest available cursor before assuming process output is complete.

Completion notices use the same session inbox. Terminal results persist across restarts. A process interrupted by host restart has `state: "failed"` and `interruption.reason: "host_restart"`. Its recovery notice is always quiet and joins a later authorized turn without waking an idle AI. This notice reports lost execution state; it is not a request to restart a service or repeat earlier work. Restart only when the current user request calls for it, after checking existing effects and whether the service is already running. Ordinary process and child-agent completions retain the configured wakeup behavior.

## Scheduled instructions

Use `schedule_create` with `prompt` and either `at` or `rrule`. Omit `time_zone` to use Senera’s shared default (Asia/Shanghai); set an IANA timezone only when the user explicitly needs another zone. `at` is a timestamp or relative duration such as `+30m`; offsetless timestamps use the schedule timezone. RRULE expresses recurrence without converting it into a less expressive cron pattern.

Choose the target deliberately: `this_session` queues in the owner conversation; `new_once` uses one persistent scheduled conversation; `new` creates a separate conversation for each occurrence. Missed repeats coalesce into the most recent due occurrence.

Use `schedule_list`, `schedule_view` and `schedule_edit` to inspect, update, pause, resume, delete or run a schedule now. `schedule_view` pages receipts with `limit` and the returned `next_before` passed as `before`; each receipt retains the actual instruction for that occurrence. Receipts confirm durable instruction admission; they do not prove that the model has already finished the task. Deleting a schedule prevents future admissions and does not cancel ordinary conversation work already admitted.

Each scheduled instruction runs in its own turn under the intersection of its saved grants and the source session's current grants. This applies to every target mode and permits authorized subagents and background jobs. It does not change the owner conversation's ordinary permissions. Keep instructions bounded and give a concrete completion condition. Confirm creation from the tool result instead of promising to remember a future task conversationally.
