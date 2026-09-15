---
name: senera-workbench
description: The Senera operational handbook. Use when the user asks to inspect or change the runtime configuration, switch models, manage or view presets, explore workspace metadata, or run system diagnostics. 当用户要求查看或修改配置、切换模型或预设、查看工作区信息、或执行系统诊断时使用。Manage Senera through the dedicated SeneraCommand surface, never by editing runtime files directly.
---

# Senera Workbench

You are running inside **Senera Agent Workbench**. Senera owns the runtime: configuration, presets, permissions, evidence, and delivery. This handbook explains how to operate the workbench itself through the controlled `SeneraCommand` surface. The command surface is runtime-discoverable: call `senera capabilities` when the installed host may have extensions or when this document and the live tool description disagree.

## Philosophy

Read `references/philosophy.md` before acting. The runtime contract returned by
`senera capabilities` (`senera.workbench/v1`) is the authority for these rules;
this Skill is the procedural projection and must not create a competing policy.
Its revision and rule index are evidence from the host, not values to guess.
The core invariants are:

1. **Evidence first** — every observed state comes from the runtime snapshot or a tool result; never assume, and never claim a change succeeded without the command result.
2. **No silent downgrades** — if a capability, preset, endpoint, or configuration path is unavailable, report it plainly. Never pretend a path or value exists.
3. **Governed self-modification** — configuration, presets, and host-owned state change only through the command surface. Do not patch files under `.senera/` directly, and do not reach into databases with shell tools.
4. **Verify every mutation** — use the returned revision and a fresh `config check`, `status`, or snapshot before reporting success; use history/rollback when verification fails.
5. **Progressive disclosure** — start with the live catalog and compact summaries. Inspect one Skill, command contract, or diagnostic detail only when the current task requires it. Reuse a confirmed revision and arguments across turns; do not trigger another search or repeat a full document merely because the resource is already visible.

The host may expose a stable `senera.skill_library` directory before the turn
starts. It is metadata, not Skill instructions: choose by name, summary, tags,
use cases, and revision, then use the live `SeneraCommand` contract: `skills
inspect` takes the Skill name for its summary, while `skills read` takes the
name, package-relative path, and optional revision for one resource. Never
infer a filesystem path from a logical Skill entry.

Skill commands use the live registry: `/skill-name` is the canonical explicit invocation and `$skill-name` remains a compatibility spelling. Never invent a command from a remembered list; resolve the current catalog first, and treat missing or conflicting entries as explicit errors. A catalog or resource revision already confirmed in the current turn is reusable evidence.

## Workflow

1. When the request concerns the workbench, call `capabilities` if the command surface is unclear, then inspect only the relevant section of `references/cli-reference.md`.
2. Read the current state (`config get`, `status`, or `workspace info`) before choosing a mutation.
3. Execute the smallest matching command through `SeneraCommand`. Its JSON arguments are the structured form of the CLI command line.
4. Read the returned `text`/`data`, including `revision`, approval state, and diagnostics.
5. Verify a successful mutation with a fresh snapshot or `config check`; report the observed result, not an assumption.
6. If a mutation is rejected, do not bypass the command surface. Explain the reason or use `config history`/`config rollback` after verification.

The live `SeneraCommand` input schema is the executable authority. `capabilities`
also returns its command-contract revision; reuse that revision and the returned
parameter shape during the current turn. When a call returns `ok: false`, read
`error`, `data.issues`, and the bounded diagnostics before repairing the same
call once. Do not replace a rejected self-service call with `ShellCommandTool`:
shell has no active-session binding, approval replay, revision guard, or live
snapshot publication. The `senera` shell CLI is only a human-facing transport
to the same host executor.

For Skill work, use the same evidence loop: list the live catalog, inspect the
named Skill through its registered source, read only the required package
resource, then run `skills check` before claiming that a Skill is usable. A Skill is an instruction asset, not a
permission grant. To preserve a useful rule learned during the current task,
create or update only a workspace Skill through the command surface, use a
complete `SKILL.md`, and wait for the normal approval result. The host stages
and validates the document, returns a content revision, and keeps the previous
revision recoverable. Never overwrite a changed revision: pass the revision
returned by `list`/`inspect` as `expectedRevision`, and re-read after a
conflict. System Skills remain immutable. Use `skills history NAME` followed by
`skills restore NAME REVISION` for an explicit rollback.

## Command Surface

The CLI and model use one vocabulary, but this Skill intentionally does not
copy the complete command table. The executable `SeneraCommand` schema is the
only parameter authority; `capabilities` returns its live revision and the
registry's current descriptions. Read only the relevant section of
`references/cli-reference.md` after that discovery.

The JSON shape is the CLI shape: `command` is the subcommand, `action` is the
verb, and positional values become named fields. For example:

```json
{"command":"config","action":"get","path":"DefaultModelProviderId"}
{"command":"config","action":"update","path":"Server.AccessControl.Mode","value":"auto"}
{"command":"preset","action":"use","name":"tester"}
{"command":"doctor","action":"status"}
```

`session` model operations use `action: "model"` plus `operation: "get"` or
`"set"`; the host binds the active `sessionId` for model calls. Omit optional
fields rather than sending empty placeholders. Never infer a new command or
field from this example list.

## Invariants

- **Never use shell tools to read or write Senera's own configuration, preset files, Skills, or `.senera` data.** Use `SeneraCommand`.
- The `senera` CLI is the human-facing twin of `SeneraCommand` with the identical vocabulary; it calls the running service over HTTP and fails loudly when the service is offline. Suggest it when the user wants to run a command themselves.
- Configuration paths use dot notation (`ModelProviderEndpoints.0.BaseUrl`). Secrets are redacted in every read projection.
- Preset names resolve with or without the `.json` suffix (`tester` and `tester.json` both match).
- The command surface is controlled by design: config, preset, and workspace Skill mutations always go through host services (approval, revision guard, schema validation, atomic activation, and verification).
- `capabilities` is the runtime source of truth for built-in and plugin command definitions; do not invent an unavailable command from memory.
- Skill names and sources are runtime facts. Use `skills list` or `capabilities` before relying on a remembered Skill; duplicate names are an explicit conflict, not a silent precedence fallback.
- `skills inspect` is source-bounded and read-only. It cannot be used to read arbitrary files or modify a Skill.
- `skills search` is a bounded metadata lookup. It is suitable for discovering a Skill, not for loading its instructions; inspect or read only the selected package and keep the returned revision.
- `skills resources` and `skills read` are source-bounded; paths are relative to the selected package, hidden files and traversal are rejected, and `read` can require the current revision.
- `skills diff` compares package resources by digest before a mutation or restore; a missing or malformed revision is an explicit error.
- Skill mutation is workspace-scoped and revisioned; it never modifies system Skills or silently overwrites a newer revision.
- Editing project source code is a separate workflow. Use the normal workspace/edit/test/Git tools for project files, and do not claim a runtime configuration change has modified source code.
- When the tool is unavailable (host did not bind the service), say the host did not expose it rather than inventing an alternative.
- To change the current conversation's model, use `session/model` rather than changing the global default. The current turn stays pinned; verify the returned preference and the following session snapshot.

See `references/presets-guide.md` for preset semantics and `references/cli-reference.md` for the full command dictionary.
