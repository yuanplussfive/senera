# Senera Command Reference

The `senera` command surface has one vocabulary and two equal entry points:

- **`SeneraCommand`** host tool — the model-facing surface, executed in-process against the live host services (revision guard, mirror write, live broadcast).
- **`senera` CLI** — the human-facing surface (`senera config get ...`, `--json` supported), which discovers the running service through `.senera/runtime.json` and dispatches the identical command implementation over `POST /senera/self` with the runtime bearer token. There is no offline file-writing path: if the service is not running, the CLI reports that plainly and touches nothing.

Both entry points therefore commit through the same host services, so a change made from either side is revision-guarded, schema-validated, mirrored, and broadcast to the frontend.

The executable Zod contract is authoritative for the JSON shape. The CLI
registry supplies usage text and governance metadata, and the build verifies
that their built-in command IDs match. `capabilities` returns the resulting
contract revision. Treat a command response with `ok: false` as a structured
repairable result: use its `error`, `data`, and diagnostics, then correct the
same invocation instead of falling back to raw shell or direct file edits.

## capabilities

| Action | Arguments | Returns                                                                                                                                                               |
| ------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —      | —         | The live self-service protocol version, every built-in/plugin command with its usage, arguments and sensitivity, the governing invariants, and the mutation workflow. |

Use this command before relying on remembered command names. Plugin commands are only listed after the live plugin registry has loaded them.

## config

| Action      | Arguments              | Returns                                                                                                                                               |
| ----------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get`       | `path?` (dot notation) | Value at path; secrets redacted (`***`). Omit path for the whole effective snapshot.                                                                  |
| `models`    | —                      | Model provider list: id, providerId, model, planning mode, context tokens.                                                                            |
| `endpoints` | —                      | Default provider id and endpoint list: id, enabled, kind, baseUrl.                                                                                    |
| `history`   | —                      | Retained configuration revisions, newest first (revision, source, timestamp). Empty when the config store is disabled — never a silent approximation. |
| `rollback`  | `revision`             | Restores a historical revision as a NEW revision on top of the current state. History is append-only; the target revision is never rewritten.         |
| `update`    | `path`, `value`        | Commits one path change through the host config service. `value` of `null` clears the key.                                                            |

Examples:

- `config get ModelProviderEndpoints.0.BaseUrl`
- `config get DefaultModelProviderId`
- `config update DefaultModelProviderId gpt-5.6`
- `config update ModelProviders.0.Temperature 0.2`
- `config history`
- `config rollback 3`

Notes:

- Paths are dot-separated; array elements use numeric segments.
- Reads are always redacted; writes commit the raw value after schema validation.
- A failed commit reports the exact path issue.

### Sensitive path approval

Config paths are graded by sensitivity rules:

- **`guard`** paths (e.g. `ModelProviders.*.Temperature`, `TopP`, `PresencePenalty`, `FrequencyPenalty`) are machine-adjudicated: the value must pass the declared constraint schema, then the update proceeds.
- **`human`** paths (access control, listener address/port, model endpoints, provider credentials, default model) require a human decision. The model-facing tool opens the frontend approval card per the session approval mode (`always_ask`); the CLI runs an interactive `[Y/n]` prompt, or `--yes`/`--no` with `--json`.

Both `config update` and `config rollback` adjudicate against these rules (rollback diffs the target revision against the current config). A pending decision is deferred with an `approvalId`; the original command is bound to that id and replayed only after explicit approval:

## approval

| Action    | Arguments              | Returns |
| --------- | ---------------------- | ------- |
| `resolve` | `approvalId`, `approve | deny`   | Completes a deferred sensitive operation: `approve` replays the original bound command (new revision), `deny` drops it without touching config. |

The CLI performs this handshake automatically: when a command defers, it prompts for `[Y/n]` and resolves with the chosen decision. `approval resolve` with an unknown or expired id fails deterministically.

## preset

| Action   | Arguments         | Returns                                                                                     |
| -------- | ----------------- | ------------------------------------------------------------------------------------------- |
| `list`   | —                 | Active preset and all presets with titles and active markers.                               |
| `show`   | `name`            | Selected preset meta: title, core persona summary, language style, example and lore counts. |
| `use`    | `name             | null`                                                                                       | Activates a preset (or resets to none with `null`). |
| `create` | `name`, `content` | Creates or updates a persona card (`senera.persona/v1` JSON).                               |

Notes:

- Names resolve with or without the `.json` suffix.
- Activation state is durable; the active preset is reflected on the next turn's persona context and broadcast to the UI.
- `content` must be a valid persona card JSON; invalid cards are rejected with diagnostics.

## workspace

| Action | Arguments | Returns                                                                                          |
| ------ | --------- | ------------------------------------------------------------------------------------------------ |
| `info` | —         | Workspace root, state/data directories, skills root, MCP root, database paths, deployment modes. |

## session

| Action  | Arguments                                  | Returns                                                                                                                                                  |
| ------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model` | `get SESSION_ID` or `set MODEL SESSION_ID` | Reads or sets the durable model preference for one conversation. `set` validates the model against the active catalog and takes effect on the next turn. |

Examples:

- `{ "command": "session", "action": "model", "operation": "get", "sessionId": "session-id" }`
- `{ "command": "session", "action": "model", "operation": "set", "modelProviderId": "gpt-5.6" }` (model tool; active session is bound automatically)

The session model preference is intentionally separate from the effective model receipt, the global default, and Pi's last-run metadata. A successful set publishes a session snapshot so the UI updates without a reconnect; `get` reports each source separately.

## skills

| Action      | Arguments                             | Returns                                                                                               |
| ----------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `list`      | —                                     | System and workspace Skills with source, revision, recommended tools, and validation state.           |
| `search`    | `query`, `limit?`                     | Bounded metadata candidates ranked for a task; Skill bodies are not loaded.                           |
| `inspect`   | `name`                                | The full `SKILL.md`, package resource catalog, and source metadata for one uniquely resolved Skill.   |
| `resources` | `name`                                | Lists package resources with type, byte size, and digest.                                             |
| `read`      | `name`, `path`, `revision?`           | Reads one relative package resource; an optional revision rejects stale reads.                        |
| `diff`      | `name`, `revision`                    | Compares active package resources with a retained revision by digest.                                 |
| `check`     | `name?`                               | A validation report for all Skills or one named Skill.                                                |
| `history`   | `name`                                | Retained workspace revisions, newest first, with action and timestamp.                                |
| `create`    | `name`, `content`                     | Creates a validated workspace Skill from a complete `SKILL.md`; approval required.                    |
| `update`    | `name`, `content`, `expectedRevision` | Atomically replaces `SKILL.md` after an optimistic revision check; the previous revision is retained. |
| `archive`   | `name`, `expectedRevision`            | Removes a workspace Skill from the active catalog while retaining its full revision for restore.      |
| `restore`   | `name`, `revision`                    | Restores exactly one retained revision; an active Skill is never silently overwritten.                |

Reads are source-bounded and never choose a duplicate name implicitly. Resource
paths are relative to the selected package; traversal, hidden files, symbolic
links, and oversized resources are rejected. The returned digest and revision
are reusable evidence for later reads, so the model does not need to search or
reload the same resource. Writes
can target only the unique workspace Skill source; system Skills are immutable
from this command surface. Every mutation validates the staged document before
activation, requires the normal approval transport, and returns a content
revision. `update` and `archive` accept `expectedRevision` so a stale model
cannot overwrite a newer user edit. A missing source, invalid frontmatter,
duplicate name, conflict, or malformed history entry is reported explicitly.

## sessions, logs, plugins, status

- `senera sessions list` returns the recent session catalog exposed by the host.
- `senera logs list` lists bounded `.log` files; `senera logs tail NAME [LINES]` reads only a bounded tail.
- `senera plugins list` reports discovered, enabled, loaded and failed plugins without hiding discovery errors.
- `senera status` reports the live service manifest and current configuration revision.

These commands are observational. They do not replace the workspace/edit/test/Git workflow for changing project source code.

## doctor

| Action   | Arguments | Returns                                                                                              |
| -------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `status` | —         | Local health: config validity (has a default model), workspace read/write, state directory presence. |

Notes:

- The doctor is intentionally local and network-free; it never probes external boundaries.
