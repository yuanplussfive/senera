---
name: senera-workbench
metadata:
  senera:
    icon: tools
description: Inspect or change Senera configuration, models, presets, channels, Skills, diaries and runtime diagnostics through the host-provided senera CLI. 查看或管理工作台配置、模型、预设、渠道、技能和日记时使用。
---

# Senera Workbench

Run `senera` through `ShellCommandTool` with `executionTarget: "Local"`.
The host supplies the executable, workspace and current session credential to
that process. This also works in the desktop distribution without a global
Node installation. Sandbox execution does not expose the host command surface.

## Discover only what is needed

- `senera --help`: domain index.
- `senera config --help`: built-in domain usage without a service request.
- `senera capabilities config update --json`: the running host's command metadata
  and exact `inputSchema`, derived from its executable validation schema.
- `senera capabilities DOMAIN --json`: all actions in one domain, including
  installed plugin commands. Reuse a confirmed command contract until it changes.

Read current state, perform the smallest requested mutation, then verify the
result with a fresh snapshot or diagnostic. Inspect `ok`, `text`, `data`,
`revision` and the process exit code. Nonzero exit and `ok: false` indicate a
failure. Starting a Shell resource is not completion; follow its existing
resource ID when the command is still running.

## Structured input

Use positional arguments for simple reads. For JSON values and multiline Skill
content, pipe exactly one JSON object to `senera --input - --json`. Use the
returned `inputSchema`; do not build JSON by interpolating unescaped content.

PowerShell:

```powershell
@'
{"command":"config","action":"get","path":"DefaultModelProviderId"}
'@ | senera --input - --json
```

POSIX shell:

```sh
senera --input - --json <<'JSON'
{"command":"config","action":"get","path":"DefaultModelProviderId"}
JSON
```

`--json` preserves documents in `text`, alongside structured data and errors.
Model-facing results retain the producer's declared data slice and revision.
Never read process credentials, `.senera/runtime.json`, or a database to call a
command. Scoped credentials expire with the Shell process; an expired or
unavailable connection is reported explicitly and never switches identities.

## Operations

Read `senera status` or the relevant domain before making changes. Configuration
and channel mutations retain validation, redaction, revision tracking and live
UI broadcasts. Use `config history` and a verified revision for rollback.

Read presets before enabling them. Preset selection, session model changes and
diary operations bind to the current session or its Agent. Omit `sessionId` and
`agentId`; the host verifies ownership. A model change takes effect next turn.

Read Skills with `senera skills read NAME PATH`, where PATH is relative to the
registered package. Use `skills inspect` or `resources` to discover its contents;
never infer a disk path from a catalog name. Skill changes apply only to the
workspace source and require the current revision where the contract says so.
Check and reread the resulting revision after a mutation; inspect history before
restoring an older revision.

For logs, start with `logs health` or `streams`, then use the matching latest,
range, session or trace command. Continue through the returned cursor and read
individual detail records as needed. Avoid scanning the log store directly.

For provider failures, inspect `logs trace REQUEST_ID` and the
`pi.provider.stream_summary` detail. It links the actual provider/API/model,
termination, usage, stream counts and tool calls. Verbose diagnostics retain
bounded raw event structure with content strings omitted. Zero raw events do
not prove no request ran; distinguish transport failure, cancellation and output
validation using the recorded outcome. A missing trace or a `busy`, `failed`,
`budget` or `disabled` persistence state describes diagnostics, not model success.

For historical work, use `senera diary list` for recent titles, then
`senera diary read YYYY-MM-DD`. `diary list YYYY-MM` discovers an older month;
`diary read YYYY-MM` reads its completed monthly diary. Titles aid discovery;
use the body for detail and memory recall for original knowledge evidence.

## Approvals and failures

Sensitive commands use the current session's approval mode and frontend card.
Wait for that result; never use `--yes`, `--no` or `approval resolve` to approve
your own operation. Those switches belong to the independent human CLI.

Host configuration, workspace Skills and `.senera/` data change through this
command executor. A rejected command does not authorize raw file or database
edits. Inspect returned diagnostics, correct the arguments and verify the next
result. Do not invent endpoint addresses, Agent identities or alternate stores.

[Command index](references/cli-reference.md) is generated from the registry.
[Workbench principles](references/philosophy.md) explain the host invariants.
