---
name: plan-implementation
description: Build an executable plan from verified constraints. Use when a task needs ownership boundaries, ordered code changes, contract updates, migration decisions, rollout risks, or acceptance checks before implementation.
---

# Plan Implementation

## Reconstruct The Contract

- State the goal, current behavior, desired behavior, and constraints using repository evidence.
- Identify the owning module and the callers, persisted data, protocols, generated artifacts, and tests affected by the change.
- Separate required work from optional improvements. Surface ambiguity instead of filling it with guessed fields or compatibility layers.

## Order The Work

- Name exact files and symbols, and order changes by dependency.
- For each material step define the contract it preserves or changes and an acceptance check that can prove it.
- Include validation, migration, rollout, and failure-path considerations when they are part of the boundary.
- Prefer an existing abstraction and local pattern over a parallel mechanism.

## Finish The Handoff

Stop when another agent can implement the plan without repeating repository discovery. Return ordinary text with the evidence basis, ordered plan, acceptance checks, open decisions, and residual risks. Do not edit files or turn the plan into an invented JSON schema.
