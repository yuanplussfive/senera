---
name: execution-workflow
metadata:
  senera:
    icon: terminal
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

Use ToolSearch to discover repository, patch, shell, and verification tools when they are not already visible. Reuse the current contract from search `contracts`, retained ToolDescribe results, or preparation feedback. Use ToolDescribe for missing or unclear contracts. Call Bootstrap and native-declared tools directly. For other Dynamic tools, Native invokes through ToolCall while BAML loads the tool before direct invocation. A preparation result with `execution_status: "not_started"` reports no executed effect; read its contract and argument issues, then submit the intended operation explicitly.

Use Codemode when several tool calls, a batch query or result filtering can be
expressed clearly in one JavaScript body. Reuse a known current contract.
For unknown tools, use `await searchTools(query, { limit?, namespace? })` for
the host's normal retrieval and current declarations, or
`await describeTool(name)` for exact input/output schemas. Discovery returns
producer namespaces; `await describeNamespace(name)` lists their callable
tools. `ALL_TOOLS` also lists the callable declarations. Do not read source
files just to learn a tool contract. Call the named tool through `tools`; do
not wrap it in ToolCall or bypass it with shell commands. The callable catalog
is fixed for that script. Script search stays within that catalog; newly
registered tools become available in the next script.

Await every call. Use `Promise.allSettled` for independent reads, inspect
rejections through `reason.message`, and sequence dependent operations and
mutations. Pass only needed fields to `text()` or `return`; full child results
remain available in their normal Artifacts. `store(key, value)` and `load(key)`
retain JSON on the current session branch after successful execution. Scripts
cannot import modules or access Node, the filesystem or network directly.
Approvals, cancellation and resource conflicts still belong to each tool.
Interactive tools and tools that suspend inference must be invoked directly.
After a script fails, inspect completed calls before repeating any mutation;
failure does not roll back external effects. Scripts are never replayed after
restart.

Calls resolve to their declared business results directly, without an
observation wrapper. For an output schema with a `results` array, read
`value.results`, not `value.detail.result.results`. A call failure rejects;
an empty array in a successful result is not a failure. Validate required
fields and report a shape mismatch instead of inventing `{}` or `[]`.
Reuse prior results in variables, or keep small summaries, IDs, resource
references and cursors in the branch store. Read large saved results through
their Artifacts instead of repeating the external request. Keep source links,
completeness and individual failures when selecting the returned fields.

For work that needs several steps or a noticeable wait, briefly say what you
will do before starting. Report a verified milestone when it changes what the
user knows: a cause found, a repair completed, a remaining obstacle or a
decision they need to make. End with the result, validation and unresolved
limits. Quick answers need no progress ritual; avoid timer-based filler and
announcing every tool call. Use the delivery mechanism of the current surface;
channel-specific speaking rules belong to `channel-conversation`.

Additional user messages can arrive while tools or inference are running. Read
the host-delivered supplement before the next stage, incorporate corrections
and constraints into the active goal, and retain separate requests for later
work. Acknowledgement of receipt does not mean a task was completed. Do not
repeat a side effect merely because a connection was interrupted; first read
the durable result or delivery receipt.

When a saved result is shown as a structure outline, use ArtifactReadTool with
`requests: [{ uri, part: "result", paths: ["/field", "/items/0/url"] }]` to read
the fields needed for the task. Use the URI and paths actually returned by the
host. Omit `paths` to inspect a part's structure, or use
`requests: [{ uri, part: "result", paths: ["/items/0"], view: "structure" }]`
to inspect one subtree. Outline `fields`/`items` are presentation containers;
use the descriptor's source path for the next read. `part: "process"` reads
exit status and output streams. `part: "outcome"` with
`paths: ["/assessment/error"]` reads the exact saved failure and diagnostics
when its observation contains only a preview. `paths: [""]` selects the whole part and may
require compression. Check each selection's status, representation
and completeness before relying on it. Preserve exact URLs and resource
references; repeat the original action only when fresh execution is needed.
