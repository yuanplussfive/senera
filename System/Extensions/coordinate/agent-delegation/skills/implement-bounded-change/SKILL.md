---
name: implement-bounded-change
description: Implement and verify a scoped repository change. Use for bounded bug fixes, feature work, contract changes, test additions, and refactors with a clear owner and acceptance condition.
---

# Implement Bounded Change

## Prepare

- Read the governing project and module instructions, then inspect the relevant code, contracts, callers, tests, and current worktree state.
- State the acceptance condition internally before editing. Preserve unrelated user changes and generated-file ownership rules.
- Reuse the existing domain service, schema, event, permission, persistence, and runtime boundary that owns the behavior.

## Implement

- Make the smallest coherent change that satisfies the task and its failure paths.
- Keep protocol fields explicit and typed. Do not add guessed aliases, silent fallbacks, arbitrary hard limits, or a second implementation path to mask an unresolved contract.
- Add focused regression coverage for changed behavior and preserve existing tests.

## Verify And Handoff

- Run the narrowest relevant formatter, type check, and tests; expand verification when the change crosses a shared boundary.
- Re-read the diff for accidental scope, stale generated output, and missing error handling.
- Return ordinary text with the outcome, touched surfaces, verification results, and remaining risk. Stop after the acceptance condition is proven or report the concrete blocker; do not keep changing unrelated code.
