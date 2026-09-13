---
name: agent-orchestration
description: Coordinate substantial work through native Senera child agents when independent investigation, specialized analysis, or parallel branches improve evidence quality. Use AgentSpawn for bounded assignments, AgentList to recover background work, and AgentWait, AgentInput, AgentStop, and AgentResume for lifecycle control. Avoid delegation for simple, tightly coupled, or latency-sensitive work. 适用于独立板块并行调查、专门审查与职责隔离；简单任务不要委派。
---

# Agent Orchestration

Use child agents for genuine context or responsibility separation, not merely to add model calls.

## Choose The Smallest Useful Delegation

Delegate only work that is independently bounded, specialized, long-running, or materially benefits from a separate context. Do the work directly when it is a simple lookup, a small edit, or a latency-sensitive step whose result is needed immediately.

## Spawn Independent Work

`AgentSpawn` always starts in the background and returns a child-run ID immediately. Its result also reports `disposition`: `created` means a new execution was admitted, while `reused` means the same logical assignment was already running or persisted. Give each child one self-contained objective with its scope, constraints, expected evidence, and the text result needed by the parent.

Omit `agent` when the host-declared default role is suitable. When specialization matters, choose only a role listed in the current Tool description. Role contracts and host configuration own workspace access, Tools, Skills, model selection, thinking, deadlines, and inherited approval policy.

Issue multiple independent `AgentSpawn` calls in one native Tool batch so the host can launch them concurrently. Give retries of the same assignment the same `workItemId`; the host also derives a task identity when it is omitted. Use a distinct `workItemId` for intentionally repeated work, such as separate images or independent variants. After spawning, continue useful parent work that does not duplicate the delegated assignments.

Declare the assignment's owned scope when it is known. Use capability-level resources, for example `{"capability":"senera.workspace.path","value":"src/AuthService.ts","intent":"replace"}` for a file the child may modify, or `intent":"read"` for an inspection-only scope. Never invent `domain`, `identity`, `access`, or overlap rules; the host resolves those through the registered capability. If the scope is genuinely unknown, omit `resources` and treat the returned `resourceCoverage: "unscoped"` as an explicit risk signal. The host still enforces claims produced by every actual tool call.

The volatile workflow context lists active and unconsumed assignments. Treat those entries as ownership boundaries: do not re-investigate or edit the same scope in the parent, even if the child has not completed yet.

When a parent or another child reaches an overlapping exclusive claim, the host queues the operation behind the owning run and releases it only after that run settles or is cancelled. Use `AgentList` to inspect ownership and `AgentWait` for dependent work; do not work around a resource wait with a second tool or a renamed task.

Treat each spawned assignment as owned by the child. Do not perform the same investigation or edit again in the parent while that child is active. Start dependent work only after the required child result is available.

## Coordinate By Lifecycle

Use `AgentWait` only when a child result is needed for the next decision. Pass every relevant run ID in one call; it returns when any target settles or requests parent input and durably records terminal results as consumed. A wait timeout only ends that observation call and never stops a child.

When the next parent action depends on a child, keep waiting for its terminal state or supervisor request. Do not use repeated short waits as polling. If an observation returns an active child, use its progress phase, active tools, tool counters, last activity, and checkpoint availability to decide whether it is still making progress.

Use `AgentInput` to communicate with an active child:

- `interrupt: false` queues a follow-up after its current assignment.
- `interrupt: true` redirects active work at the next safe Pi boundary.
- An `awaiting_supervisor` child consumes the message as its decision response and resumes in the same session.

Use `AgentStop` when a child and its descendants are no longer needed. `accepted: true` only confirms that the stop request entered the control plane; `state: stopping` remains visible until the runtime really settles. Use `AgentResume` only for a settled child whose persisted context should execute a new explicit task.

Ask a child to consolidate its existing evidence with `AgentInput` only when the host reports stalled activity or wrap-up. Do not infer a stall from a single long tool call, a wait observation timeout, or the absence of a new final message. A checkpoint or active tool is evidence that the child still has useful work in flight.

## Preserve Ownership

The parent owns the final answer and cross-child decisions. Do not repeat delegated work while a child is active. Verify material child claims, resolve contradictions, and close unneeded runs before finishing. Child results are ordinary assistant text, not a JSON envelope.
