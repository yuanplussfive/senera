# Senera Philosophy

Senera is an observable, verifiable agent workbench. The principles and change lifecycle below govern every operation the model performs on the workbench itself.

The authoritative contract is the live `senera.workbench/v1` projection returned
by `senera capabilities`. This document explains how to apply it; if this text
and the live contract disagree, follow the contract and report the discrepancy.
The contract revision and rule IDs should be carried forward when a workflow is
continued or verified.

## Evidence First

- Every state claim comes from the runtime snapshot or a tool result.
- A change is performed only when the command returns a success result; never infer success from silence.
- When a value is unknown, unavailable, or non-existent, say so. Do not fabricate.

## No Silent Downgrades

- If a capability, endpoint, preset, or configuration path is unavailable, the runtime rejects it explicitly and the agent reports the rejection.
- The self-service surface never silently falls back: `config update` either commits through the host services or fails with a reason.

## Governed Self-Modification

- Configuration, presets, and workspace state are host-owned. They change only through the command surface (`SeneraCommand` / the `senera` CLI).
- Never patch `.senera/` files, raw JSON, or databases with shell tools.
- Mutations are revision-guarded, schema-validated, mirrored, and broadcast so the UI stays consistent.
- High-sensitivity changes (endpoints, keys, security policy) may require approval; the tool result states when approval is required.

## Capability and Skill Lifecycle

- The live capability catalog is authoritative. Discover first, inspect the
  source and revision, then act only through a registered command or tool.
- Use progressive disclosure: a catalog entry is enough for routing, a contract
  is needed for arguments, and a full Skill document is needed only when its
  workflow instructions are relevant. A valid revision already present in the
  conversation is reusable evidence, not a reason to search again.
- A Skill is an instruction asset, not an implicit permission grant. Its
  recommended tools still pass the normal authorization and tool-search
  boundaries.
- Skill source conflicts and invalid documents are surfaced as diagnostics;
  they are never resolved by an undocumented priority fallback.
- Skill installation, update, archive, restore, and generated learning require
  an explicit mutation workflow with provenance, approval, validation, and
  rollback. Workspace Skill writes are revision-guarded and retain recoverable
  history; system Skills remain immutable. Generated learning must still pass
  the same review and approval boundary before it becomes a persistent Skill.

## Change Lifecycle

Every host mutation follows one observable lifecycle:

1. Inspect the live state and capabilities.
2. Choose the smallest command that expresses the requested change.
3. Wait for validation and, when required, human approval.
4. Verify the returned revision with a fresh snapshot or diagnostic command.
5. Roll back by creating a new revision if verification fails.

Project source code is a separate boundary. It may be inspected and changed with the workspace and Git tools, but a source edit is not a runtime configuration change and must not be reported as one. A complete source-change workflow requires its own diff, tests, and explicit runtime reload or restart.
