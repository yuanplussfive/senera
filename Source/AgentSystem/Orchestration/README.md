# Orchestration

`Orchestration` owns Senera child agents, persisted child-agent workflows, and scheduled tasks. Child work always runs through the normal Session, Loop, Pi, Safety, ToolRuntime, Artifact, database, and event boundaries.

## Runtime Boundary

```text
AgentSpawn / AgentWait / AgentInput / AgentStop / AgentResume
  -> native role catalog
  -> native preflight and capability intersection
  -> AgentDelegationService / AgentWorkflowService
  -> AgentRunDispatchGateway
  -> AgentSessionRunDispatcher
  -> AgentSessionManager / AgentLoop / Pi
```

`AgentRunDispatchPort` is the only execution port from orchestration into Session. This module does not construct a second Pi instance, model client, Tool executor, approval runtime, sandbox, or filesystem communication channel.

The bundled role taxonomy and some graph-presentation ideas were adapted from `pi-subagents` 0.40.0 under its MIT license. Attribution is retained in `System/Extensions/agent-delegation/NOTICE.md`. Senera does not load that package at runtime and does not use its process runner, TUI, temporary state, session files, or Tool extensions.

## Native Role Catalog

`AgentSubagentRoleCatalog` reads two explicit sources:

1. Bundled roles under `System/Extensions/agent-delegation/agents`.
2. Workspace overrides under `.senera/agents`.

Every role is a Markdown document with strict YAML frontmatter. Workspace definitions override bundled definitions only by canonical role ID. Unknown frontmatter fields, empty instructions, symlinks, duplicate aliases, aliases shadowing canonical IDs, and ambiguous aliases fail explicitly. A content revision covers the parsed contract and prompt.

Roles declare behavior, workspace access, and whether they may delegate descendants. They do not name Tools. Tool authorization is a host-owned runtime contract rather than role prompt metadata.

`AgentSpawnHostContractProjection` projects the revisioned role catalog and its declared default into the model-visible schema. Model, Skill, Tool, workspace, approval, and deadline policy remain host-managed rather than becoming launch arguments.

## Native Preflight

`AgentSubagentPreflight` resolves one immutable launch contract before persistence:

- canonical role and role revision;
- fresh or fork context;
- selected model and ordered model pool candidates;
- thinking level;
- pinned Skill names and revisions;
- concrete parent-authorized Tool identities;
- the intersection of parent authorization, workspace access, role delegation policy, and the inherited capability ceiling;
- prompt mode and project-context inheritance;

Tools use their registered names and exact invocation schemas throughout preflight and model exposure. Search aliases and tags remain discovery metadata and never become authorization identities. System Host Tool contributions may declare `childGrant: internal` for child-only control Tools or `childGrant: delegation` for descendant lifecycle Tools. Internal Tools are injected by the host; delegation Tools require both parent authorization and a role with `canDelegate: true`. A read-only parent cannot create a read-write descendant, and nested delegation cannot widen its inherited concrete Tool or role ceiling.

## Child Lifecycle

`AgentSpawn` durably queues one child and always returns immediately. `AgentList` recovers the durable run projection in a later turn, including progress and terminal results. Multiple spawn calls in one native Tool batch initialize independently and then run under provider and Tool-resource backpressure. The parent can keep doing non-overlapping work instead of blocking on child completion.

`AgentWait` accepts multiple child-run IDs and resolves when any target settles by default; `mode: "all"` forms an explicit join barrier and waits until every target settles. It observes typed lifecycle transitions rather than polling storage, and a timeout ends only the wait call without terminating child work. Model-visible results contain the stable run ID, public state, role, optional join-group identity, final text, error, supervisor request, and a compact progress projection when a runtime snapshot or checkpoint exists. Full snapshots, checkpoint content, deadlines, session IDs, revisions, and internal event cursors remain diagnostics.

`AgentInput` uses Pi follow-up for queued input and Pi steering for immediate redirection. A decision response resumes the same persisted child session. `AgentStop` recursively admits cancellation for active descendants before the target and returns once the requests are accepted. The child remains `stopping` until Session, Pi, Tool resources, and history have actually settled; only then is `cancelled` persisted and published. `AgentResume` starts a new detached task in the persisted child session context.

Child agents finish with ordinary terminal assistant text. The host stores that text as `finalAnswer`; models do not generate a host JSON envelope. `AgentContactSupervisor` persists typed progress or decision messages. A decision request pauses the child, and a parent response resumes the same child session.

### Completion Wake and Channel Adapters

Detached completion is delivered through `AgentDelegationCompletionPort`, not through a provider- or channel-specific callback. Each port declares a stable deployment-level `id`; `AgentDelegationCompletionDelivery` persists one delivery row per `(childRunId, portId)` before invoking the adapter. Claims have leases, attempts, retry times, and terminal `delivered`/`dropped` states, so an adapter outage or process restart does not lose a completion and two runtime instances cannot claim the same row concurrently. `ServerRuntime` binds that delivery layer to the owning parent session: it creates a deterministic completion request ID from the child run ID and revision, or from the persisted join-group ID for a parallel spawn batch, then submits a machine-readable internal wake input. A batch is rechecked against its durable `all` barrier before the parent is woken, so several child completions produce one follow-up turn instead of one turn per child. If the parent session is busy, the wake is admitted to the normal `follow_up` queue; it never interrupts the active turn. The internal input is durable model context but is omitted from the user message projection.

An external channel adapter only needs to map its stable `(account, conversation)` identity to a Senera `sessionId`, submit user messages through the Session boundary, and render the resulting event stream. Progress queries and controls remain ordinary model actions (`AgentList`, `AgentInput`, `AgentStop`, `AgentResume`) or the existing Session control requests. On restart, terminal detached records are scanned and replayed with the same request ID, so command receipts prevent duplicate wake turns. If a crash happened after the wake receipt was marked `running`, the internal completion wake is allowed to reclaim that stale receipt and reuse its persisted user entry; ordinary user requests never reclaim running receipts. A channel that wants direct push delivery can implement `AgentDelegationCompletionPort` and pass it through `SeneraServerOptions.delegationCompletionPorts`; the delivery layer fans out to all bound adapters while preserving the same session and idempotency rules. The adapter should persist its `(account, conversation) -> sessionId` mapping and use the record's `parentSessionId` to route the terminal update. Adapter-specific network retry, rate limits, and provider errors remain inside the adapter; the core only retries the durable delivery boundary.

The host configuration owns activity-aware deadlines. There is no Tool-count or assistant-turn limit: a child may start Tool work until it finishes, is cancelled, or the host explicitly enters deadline wrap-up.

## Internal Persisted DAG Workflows

The model-visible lifecycle does not expose a graph DSL or an action-discriminated control union. Independent branches are expressed as parallel `AgentSpawn` calls; dependent work is launched after `AgentWait` returns the required text.

The existing versioned DAG service remains an internal runtime facility for persisted system workflows. Every node declares:

- a stable node ID;
- role, task, and workspace access;
- explicit `dependsOn` edges;
- `task_only` or `append_dependency_results` handoff behavior;
- optional context, model, Skills, and thinking preferences.

The parser rejects duplicate IDs, duplicate edges, missing dependencies, self-dependencies, and cycles before any child run is created. When an administrator configures `workflows.maxNodes`, oversized graphs are also rejected before launch. Ready nodes launch together; provider and Tool resource backpressure remain authoritative, while optional child-run and writer quotas add deployment-specific admission limits.

`append_dependency_results` adds only the declared upstream nodes' persisted terminal text to the child task. There is no field-name inference and no implicit scan of unrelated child runs. `task_only` preserves an ordering edge without injecting upstream text.

Failure policies are explicit:

- `fail_fast`: finish the current ready batch, mark remaining pending nodes skipped, and fail the workflow.
- `continue_independent`: continue branches whose dependencies succeeded, skip only blocked descendants, and finish as `partial_completed` when any branch degraded.

Node child runs retain `ownerRunId + nodeId`, so persisted graph state and child-run history have one stable identity without duplicating result text in workflow storage.

## Models, Skills, And Permissions

`agent-delegation.modelPool` is the only child model pool. It can inherit the active parent model and include an ordered list of enabled chat-capable model IDs. Role defaults must resolve inside this pool; no `default` sentinel or cross-pool fallback exists.

Skills come from the active Senera registry. Selected `{name, revision}` pairs are persisted and revalidated before dispatch. A Skill revision change cannot silently alter a queued child contract.

Every child inherits the parent approval mode. Workspace access, registered Tool metadata, the parent authorization ceiling, and the inherited capability ceiling are intersected before dispatch. Current Tool exposure is deliberately not used as an authorization source. Child sessions cannot elevate approval, workspace write access, Tool access, Skills, model access, or the set of roles they may delegate.

## Concurrency And Lifecycle

`AgentRunConcurrencyGate` applies optional limits to total children and workspace writers. Both limits are absent by default, so read-only and writing children are not globally serialized; declared Tool resources and provider backpressure still coordinate conflicting work. Parent orchestration Tools use self-managed scheduling so a waiting parent Tool does not hold a generic Tool resource needed by its child.

Activity-aware child deadlines begin only after a concurrency permit is acquired. Typed model and Tool lifecycle events can extend the configured soft deadline within a configured bound. The wrap-up phase requests a final answer from existing evidence, and the final checkpoint remains available if the child is interrupted.

Shutdown closes admission first, pauses active workflows, then drains child delegation while Session dispatch remains bound. Explicitly cancelled workflows are terminal. Workflows interrupted by process restart become `paused`; their completed nodes remain complete and failed or interrupted child sessions can be deliberately resumed.

## Scheduled Task Timing

`@amaster.ai/pi-task-scheduler` supplies schedule parsing, `once`/`interval`/`cron` next-run calculation, and the shared task types. Senera deliberately does not start the package's `PersistentTaskScheduler`: that runner uses process-local timers and file-backed state, does not recover missed work after downtime, and cannot represent a result that is computed now but delivered later. SQLite remains the single authority for task state, atomic claims, claim recovery, hidden fork execution, and owner-session delivery.

`AgentScheduleManage.create` supports two execution modes:

- `at_due_time` is the default. The work starts at its due time and projects its normal lifecycle to the owner session before delivering a terminal answer.
- `execute_now_deliver_at` is for an enabled one-time task only. Senera creates a durable run immediately, executes it in a private fork, persists either the result or failure, and waits until `deliver_at` before appending exactly that terminal outcome to the owner session. It never re-executes when delivery time arrives.

For deferred delivery, changing the one-time schedule moves the pending delivery deadline. Disabling or deleting the task cancels undelivered reporting. A completed or stopped deferred task cannot be re-enabled or run again; creating a new task is explicit and avoids duplicate work.

Deleting a task also aborts any execution already admitted for that task and waits for its private execution session to dispose. The durable task is removed before cancellation begins, so a concurrent scheduler tick cannot claim another run.

The owner session is the lifetime boundary for every scheduled task. Session close first interrupts active scheduled forks and deletes the owner's task records; startup reconciliation removes records whose owner session was deleted by an older runtime. No scheduled execution or delivery is projected to a missing session.

## Persistence

The authoritative database is `.senera/data/orchestration/orchestration.sqlite`:

- `child_runs` and `child_run_messages` store child identity, immutable launch and execution contracts, snapshots, checkpoints, messages, final text, usage, and revisions.
- `agent_workflows` stores parent ownership, the normalized versioned DAG, definition digest, status, error, and revision.
- `agent_workflow_nodes` stores node status, child-run binding, timestamps, errors, and revisions.
- scheduled-task and scheduler-lease tables store durable timer definitions, execution history, Tool policy, and lease ownership.

All state transitions use bound SQLite statements and explicit status predicates. A restart marks active child runs interrupted and active workflows paused instead of pretending they completed.

## Events

Child lifecycle, snapshots, deadline extensions, supervisor messages, and terminal states emit formal orchestration events. Workflows emit started, snapshot, paused, cancelling, completed, partial-completed, failed, and cancelled events. Every workflow event includes the workflow ID, definition digest, and typed node states so the frontend and diagnostics layer do not infer graph state from arbitrary Tool output.

## Validation

Run at minimum:

```bash
npm run check.types
npx vitest run --config vitest.backend.config.ts Scripts/BackendTests/Orchestration
npm run verify.database-contracts
npm run verify.system-extension-contracts
npm run verify.frontend-events
```
