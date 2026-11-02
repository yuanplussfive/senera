---
name: investigate-repository
description: Trace repository behavior with focused, evidence-backed inspection. Use for codebase discovery, runtime tracing, locating callers and tests, and read-only implementation handoffs.
---

# Investigate Repository

## Establish Scope

- Translate the assignment into the smallest set of evidence questions.
- Read the governing project and module instructions before interpreting code.
- Start with exact paths, symbols, error text, contracts, and test names. Use `rg --files` and `rg` to discover only what the questions require.
- Follow direct imports, callers, configuration, persistence, and tests until the behavior is established.

## Build Evidence

- Record workspace-relative paths and line references for material claims.
- Separate verified behavior, reasoned interpretation, and unresolved questions.
- Inspect the relevant `git status` and diff when the assignment concerns current work; keep `HEAD`, tracked changes, and untracked files distinct.
- Prefer one focused trace over repeated broad scans. Do not infer a field, tool, path, or protocol from a name when its declaration can be read.

## Stop And Report

Stop when the supervisor has enough evidence to make the next decision or another role can implement without rediscovering the same context. Return ordinary text containing the conclusion, control flow, exact evidence, assumptions, open questions, and a practical handoff. Do not modify files, invent a JSON envelope, or continue searching merely to increase the amount of evidence.
