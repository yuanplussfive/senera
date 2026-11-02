# Agent orchestration

Senera uses one Pi execution engine. Child agents, process completions and scheduled instructions converge on the existing durable session queue. SQLite owns lifecycle records and delivery identities; in-memory queues only limit runnable admissions.

## Public tools

- `todo_write`: atomically replace the current plan; planning is optional.
- `subagent`: launch background work and return the child session as `agent_id` and its activation as `job_id`.
- `list_subagent_models`: discover authorized model routes, declared capabilities, context/output limits, reasoning levels and current delegation limits.
- `send_message`: communicate with a direct parent or child, steer active work, or reactivate a persisted child session.
- `list_agents`: observe direct children or recursively enumerate descendants, retaining parent identities and relative depth, without consuming results.
- `interrupt_agent`: interrupt one descendant without recursively stopping its descendants.
- `job_list`, `job_output`, `job_kill`: inspect, optionally wait for, and control session-owned commands, PTYs and child-agent activations.
- `schedule_create`, `schedule_list`, `schedule_view`, `schedule_edit`: persist schedules and admit due instructions into ordinary sessions.

The registered JSON contracts are authoritative. The former action-union and wait-mode tools are no longer registered. Historical child records and internal host operations remain readable through their existing storage types.

## Sessions and authority

A child session is the stable agent identity; a request identifies one activation. Messaging requires direct parent-child adjacency; interruption requires ancestry and stops only the target. Role definitions, pinned launch policy, Tool grants and resource claims remain host-owned. A cold activation restores the persisted launch plan rather than reselecting wider permissions. Active work uses Pi steering; idle work resumes the same session.

Resource claims identify shared or exclusive scheduling ownership; they do not grant filesystem access. The permission gate inspects assignment resources through the same capability registry used by ordinary Tools. Full access permits host paths outside the workspace. In approval mode, an approved external file or directory becomes part of the child's persisted resource scope, including descendant inheritance and cold continuation. A read-only role narrows writable resources to read access and does not inherit executable resources. Approval for one file never becomes recursive directory access. Uncovered resources and tool side effects still follow the active approval policy; links and protected workspace domains retain their boundary checks.

Workspace read, list, find, grep and patch operations use the invocation's authorized execution environment. External searches use the authorized target as their search root. Patch transactions validate every destination before committing and retain rollback for both internal and external files. Results explicitly identify external changes; workspace checkpoints and later workspace undo cover only paths inside the workspace.

Discovery and launch validation resolve the same child model pool. A new, unconfigured pool includes enabled models that meet the selected planning mode's requirements; existing explicit pool configurations keep their scope. `modelPool.includeConfiguredModels` enables this discovery for an existing pool. Turning it off restricts selection to inherited and explicitly listed models. Disabled endpoints and models lacking required capabilities are excluded; configuration errors remain explicit.

The AI may choose a route for the assignment without another user approval when that route is allowed. Omission follows role/default selection. Discovery and execution share Pi's reasoning projection: explicit unsupported reasoning levels fail before admission; inherited reasoning is retained when supported, otherwise the chosen model uses its own default. Child prompt guidance includes actual depth and tool-grant limits. Task labels persist with the launch contract. Message receipts identify accepted input, not a generated reply. Cancelling the sender after admission does not retract the message. Every reactivation gets a fresh deadline and activity budget while retaining its checkpoint and session history.

A detached child outlives the parent's tool call. The host has separate activation, provider and resource limits. Ancestor resource conflicts fail explicitly to prevent a descendant waiting on an ancestor that is waiting for it. Tree disposal remains an internal host operation; public interruption targets one child.

## Inbox and completion outbox

`AgentSessionManager.acceptHostInput` uses the session's existing admissions lock and durable queued-input store. Host inputs carry typed provenance and stable delivery IDs. The last admitted execution policy is persisted with session metadata; wakeups cannot invent an approval mode or Tool ceiling.

The shared conversation predicate distinguishes human messages from host inputs by persisted metadata. Host wakeups retain their envelope, do not reset the parent plan, do not enter `prevRequests` or human-turn learning, and do not increment the human turn number. User text that resembles a host envelope remains ordinary escaped user input.

Completion outbox identity includes child run, activation request and destination port. Each row retains its completion snapshot, so resuming the same agent cannot replace an older pending result. The parent-inbox port hands off to the same durable notification coordinator used by processes. Notification ownership, Pi consumption and model completion are separate lifecycle stages. Delivery retries reuse the same identity.

`job_output` and `job_kill` stage observation receipts. While a read or stop is in flight, its completion notice waits. Only a successful tool result committed to the native Pi transcript acknowledges the notice; cancelled or uncommitted reads leave completion available. Pending, unscheduled duplicate inbox notices are withdrawn after that commit. Cold recovery reconciles receipts with the native transcript before replay. Ordinary inventory reads remain independent and do not acknowledge results.

The jobs extension configures `completionDelivery` (`wakeup` or `quiet`), an optional `maxConsecutiveWakes`, and `inlineOutputBytes`. Quiet notices remain durable and join the next ordinary turn. The wake budget counts actual completion-triggered turns, not individual notices; human input replenishes it. Already active work can consume notices without another wake. Small results accompany notices; larger results remain available through `job_output`.

Producer-declared wake decisions persist with the notification before delivery and survive retries and restarts. An explicit quiet notice cannot initiate a recovered turn or consume a completion wake budget. When quiet notices precede user input or an eligible completion, that eligible input owns the turn and the quiet notices join through the ordinary Pi input boundary.

Queued recovery delegates child-session activation back to the delegation service, including notifications from jobs and descendants. It cannot silently start an unmanaged ordinary session. The same activation limits, resource claims, pinned permissions and completion ports apply; original input metadata and attachments survive recovery.

Interruption parks unconsumed child inputs until explicit `send_message` continuation, including cancellation that races queued activation admission. Stopping a child does not stop its descendants.

## Background jobs

`AgentJobRuntime` observes background processes (`UntilExit`) and PTYs in `AgentExecutionResourceBroker`, and activations in `AgentDelegationService`. Producers retain their execution ownership; the job runtime supplies one inventory, read, wait and stop interface. Agent snapshots store the label, progress and result rather than duplicating launch policies and checkpoints. Each activation keeps its own SQLite record; stopping an old activation cannot stop the agent's newer work.

Optional `job_output` waiting ends on settlement, a configured deadline, human steering or cancellation of the read. The producer keeps running. Waits use lifecycle notifications rather than polling and release timers/listeners on every exit. `waitTimeoutMs` defaults to 30 seconds; requests are clamped to `maxWaitTimeoutMs` (10 minutes by default). An explicit `timeout_ms: null` uses that maximum for one completion wait. The tool reserves that wait separately from its ordinary processing budget; process-output collection limits do not clamp job waiting. The returned delivery policy exposes the effective limits and whether an idle parent can wake. Explicit process-output cursors do not mutate another observer's position. Terminal snapshots and notification receipts persist; unfinished processes after host restart are marked failed and never rerun automatically. Persisted output is bounded, not an unlimited transcript.

Cold recovery records a `host_restart` interruption and a terminal state event, clears the obsolete PID, and retains the existing job identity and output. `job_list`, `job_output` and the notification expose that structured interruption. Recovery notices are always quiet, even under the global wakeup policy; restoring process records must not wake an idle AI to recreate a service. A recovery notice reports state and does not request another execution. Ordinary process settlement and child-agent completion continue to follow the configured delivery policy.

`subagent.todo` explicitly associates an assignment with an existing in-progress parent plan step by its exact content. The launch contract persists the resolved Todo identity; task deduplication includes that identity. All linked children must complete successfully before the host completes the step, and pending launch admissions defer synchronization. Failure and partial completion leave it open. Unchanged steps retain their identities across plan writes, while removing or clearing a step severs the association. Completion cannot recreate it or alter a later same-named step. Startup reconciliation repairs a missed derived Todo update without changing the persisted child outcome. Model-facing progress and prompt context share one projection, including the child's actual Todo and final progress snapshot.

## Schedules

RRULE uses `rrule-temporal` and the existing Temporal implementation with a persisted timezone-aware DTSTART. Existing cron and interval records remain supported through `croner` and the owned schedule definition. Omitted timezones use the shared `DefaultAgentTimeZone` (Asia/Shanghai); explicit IANA zones override it only for that schedule. Missed repeating occurrences coalesce; run claims and deterministic inbox delivery IDs prevent duplicate admission after recovery.

Targets are the owner session, one persistent scheduled session, or one new session per occurrence. Normal due-time work queues the instruction and returns an admission receipt. That receipt does not represent successful model execution. Legacy execute-now/deliver-later records retain their deferred-result lifecycle internally.

Every admitted instruction has a turn-specific ceiling: the stored schedule grants intersect the source session's current ceiling. This applies to all target modes, including existing `new_once` sessions and managed child activations. A scheduled instruction waits for its own turn instead of steering a different execution policy into active work. Its policy does not overwrite the owner conversation's ordinary policy. Authorized orchestration tools remain available; there is no namespace-wide exclusion of delegation or job tools.

`p-queue` bounds admission concurrency. Durable claims, permissions, target identities and receipts remain in SQLite. Removing a schedule does not cancel user conversation work already accepted. Shutdown drains admissions before stores close.

Definition and tool-authority edits share a SQLite transaction so they cannot overwrite concurrent claim counters or next occurrences. Each occurrence stores an immutable instruction snapshot. `schedule_view` reads bounded receipt pages with an exclusive `before` cursor; historical records without snapshots explicitly report that the original instruction is unavailable.

## Dependencies

The implementation reuses Pi, SQLite, Temporal, `rrule-temporal`, `croner` and the execution resource broker; `p-queue` handles bounded runnable admissions. DSH packages depend on its own host and are used as design references rather than introducing a second runtime. The former `@amaster.ai/pi-task-scheduler` and timezone-sensitive `rrule` dependencies have been removed.

## DSH comparison

Compared on 2026-10-31 with the published `@deepseek-ai` packages at `0.1.5-rc.3`: `dsh-tool-todo`, `dsh-tool-subagent`, `dsh-tool-subagent-control`, `dsh-tool-jobs`, `dsh-jobs-local`, `dsh-schedule` and `dsh-client-ui-subagent`. These are the inspected package versions, not a claim about every upstream revision or deployment.

| Area               | DSH reference                                                                                                                               | Senera implementation and boundary                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Todo               | Atomic full-list replacement, three public statuses, session ownership, configurable concurrent in-progress items; clear at turn start.     | Same model-facing plan semantics. SQLite stores the plan; a fresh human turn clears the previous plan, host wakeups retain it, and explicitly linked child assignments synchronize successful completion. Finished-turn plans remain in history. |
| Launch and context | Provider-declared fresh/fork, one-shot and continuable agents; optional foreground collection.                                              | Local Pi fresh/fork with persistent child sessions. `subagent` always returns a background activation; `job_output(wait: true)` can wait. There is no separate one-shot or foreground launch mode.                                               |
| Model choice       | Authorized provider/model/reasoning discovery and adapter capability checks.                                                                | `list_subagent_models` and launch use the same permitted model pool and reasoning preflight. Role, tool and depth ceilings remain host-owned.                                                                                                    |
| Messaging and stop | Direct parent-child messaging; steer active work, continue cold children, interrupt one descendant while preserving inbox and descendants.  | Same communication topology and interruption scope, backed by the durable input queue and persisted launch contracts. `list_agents` supports stable recursive descendant inventory.                                                              |
| Completion         | Busy agents receive inbox notifications; idle agents can wake, with quiet delivery and bounded consecutive wakes.                           | Shared durable notifications and completion outbox, with the same configurable delivery choices. Consumption is acknowledged only after the native transcript commits the observation.                                                           |
| Jobs               | Commands, PTYs and agents share list/output/kill. The local registry is in memory and disappears at host exit.                              | Same kinds through one runtime; separate activation identities, independent output cursors and persisted terminal snapshots. A host restart marks unfinished processes failed; it does not resume the process.                                   |
| Schedules          | The inspected `dsh-schedule` provides persistent one-time/fixed-interval reminders to a live root session; cold sessions keep them overdue. | Persistent instructions support RRULE, one-time and legacy interval/cron records, owner or dedicated target sessions, coalescing and admission receipts. Permission ceilings still apply when a cold target activates.                           |
| Execution display  | Compact descendant tree, full child conversation navigation, token/timing metadata, direct continuation input and independent Stop.         | Stable activity rows, real tool/Todo counts, feedback traces and child details. The complete descendant conversation navigator, direct child composer/Stop controls and activation chooser are not yet exposed in this UI.                       |
| Recovery           | Session logs own Todo and child identity; local jobs themselves are not persistent.                                                         | Parent history detail reuses the live child projector for lifecycle, messages, thinking and snapshots. Older state events enrich missing fields without regressing newer state or reactivating the parent.                                       |

The core local execution capabilities are implemented, but the complete DSH product surface is not. External ACP/Codex/Claude Code execution backends, separate one-shot launch semantics and the full child conversation UI remain gaps. Host restart preserves records and pending inputs, not OS processes or in-flight provider streams.
