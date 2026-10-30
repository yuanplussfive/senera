---
name: senera-git-workflow
description: "Manage Senera Git contribution work safely: classify branches, keep personal integration work separate from reviewable topic PRs, rebase only when appropriate, and verify CI and human review state. Use when the user asks to 整理工作区、检查或切换分支、fetch、rebase、提交或创建 PR、处理合并冲突，或确认 CI 与人工 review 状态。"
metadata:
  senera:
    recommended-tools:
      - ShellCommandTool
---

# Senera Git Contribution Workflow

Use this Skill for Git and pull-request work in Senera. Treat repository state,
remote refs, CI, and human review as separate evidence. Do not claim a PR is
ready because CI passed, and do not infer remote state from stale local
remote-tracking refs.

## Repository model

- `origin/main` is the canonical contribution base.
- `codex/senera-production` is a personal integration and backup branch. Keep
  it for accumulation and local integration, but prefer `codex/<scope>` topic
  branches for reviewable PRs.
- A topic branch should start from the current `origin/main` and contain one
  coherent user-visible outcome or migration boundary.
- Use stacked branches only when there is a real dependency. Keep the stack
  shallow and retarget the child to `main` after the parent merges.
- `nano` is generated from validated `main` and does not accept direct commits
  or pull requests. `release-please--*` branches are automation-owned.

## Inputs

- The requested Git or PR operation.
- The current worktree, branch, upstream, remote refs, and relevant PR state.
- Explicit authorization for any history rewrite, push, branch deletion, or PR
  state change.

## Preflight

1. Read `git status --short --branch` before any switch, rebase, reset, or
   cleanup.
2. If the worktree is dirty, preserve the paths and stop before switching or
   rebasing. Do not stash, reset, or clean unless the user explicitly requests
   that operation.
3. Establish remote truth with `git ls-remote --heads origin`. Fetch only the
   refs needed for the requested work; do not treat an absent local
   `origin/<branch>` as proof that the remote branch is absent.
4. Inspect the current branch, upstream, merge base, and commit range before
   changing history.

## Starting contribution work

For a new reviewable change:

1. Fetch the latest `main` ref and create `codex/<scope>` from it.
2. Keep unrelated fixes, prototypes, generated release branches, and personal
   integration work out of the topic branch.
3. Commit in logical units that can be reviewed or reverted independently.
4. Run the narrowest relevant checks, `git diff --check`, and the repository
   commit-message check before pushing.
5. Push with an upstream and open a Draft PR when the scope is coherent enough
   for early review. Convert it to Ready for review only after the author is
   asking for human review.

The repository's Verify workflow runs on PR open and every synchronization and
includes build, lint/format checks, integration checks, browser E2E, Windows
smoke, coverage, and security jobs. Batch work only when the changes are truly
inseparable or when the maintainer explicitly asks for one production PR; do
not use CI cost alone to justify an unreviewable diff.

## Local versus remote checks

Use two gates, not two copies of CI:

- **Local gate:** before pushing, run `git diff --check`, the tests for the
  changed area, and the cheapest applicable type, lint, format, build, or
  contract checks. For broad source changes, add `npm run quality.lint`, the
  changed-range format check, `npm run build`, and the relevant frontend or
  integration build/test. Skip unrelated suites.
- **Remote gate:** after the PR is opened or synchronized, treat the GitHub
  Verify workflow as the final authority for the full matrix, especially
  Chromium, Windows, coverage, CodeQL, Trivy, and dependency checks.

Do not run the full local `npm run ci` by default: it largely duplicates the
remote matrix and can fail for local-only environment reasons. Run it only when
the user asks for a local full rehearsal, the change is release-critical, or a
remote failure is reproducible locally and needs diagnosis.

When remote CI fails, classify the failure before rerunning anything:

1. Reproduce code failures locally with the narrowest matching check, then fix
   and push.
2. Rerun or inspect runner failures instead of changing code blindly.
3. Keep Windows, browser, coverage, and security results as remote evidence;
   local approximations do not replace them.

Green CI proves automated checks only. It does not prove Ready-for-review,
maintainer approval, or merge readiness.

## Personal integration branch

Continue using `codex/senera-production` as a private accumulation branch when
that reduces context switching. Before publishing it as a PR, classify the
diff into reviewable topics. Do not create duplicate PRs merely because a
Draft PR has no approval. A Draft PR is not yet a request for review; CI green
is an automated gate, not maintainer approval.

If a maintainer asks to split a large PR, create replacement topic branches
from `origin/main`, move one coherent boundary into each, verify each PR, and
close or mark the umbrella PR superseded only after the replacements are ready.
Do not copy the giant diff into several overlapping branches.

## Rebase and update rules

- Rebase only from a clean worktree and after recording the old branch tip and
  base. Reuse `git range-diff` to confirm that the intended patch survived.
- Do not repeatedly rewrite a branch while it is under active review unless a
  conflict or maintainer request requires it.
- A rebase of a pushed branch requires `git push --force-with-lease`, never raw
  `--force`, and only with explicit authorization. Stop if another contributor
  may be using the branch.
- Prefer a fresh topic branch over repairing a long-lived branch whose diff is
  already stale, overlapping, or difficult to review.

## PR state and delivery

Track these states separately:

- local source and tests passed;
- remote CI checks passed;
- PR is Draft or Ready for review;
- maintainer reviewed or requested changes;
- PR merged, closed, or superseded.

When the user has already contacted the maintainer privately, do not add a
public reminder comment just to announce that CI passed. Report the exact PR
state and wait for the maintainer's direction before splitting or closing it.

## Outputs

Report the resulting branch and upstream, commit range, files changed, local
checks, remote CI result, and maintainer-review state. Separate observed facts
from inferred ownership, intent, or readiness.

## Safety

Never run `git reset --hard`, `git clean`, raw force-push, branch deletion,
remote branch deletion, PR closure, or PR-state changes without explicit
authorization for that operation. Preserve unrelated WIP and report the exact
branch, upstream, commit range, CI result, and review state after every
mutation.

## Verification

After a mutation, re-run `git status --short --branch`, inspect the new HEAD
and upstream, confirm the remote ref or PR state, and run the narrowest useful
checks. Do not report success from a command that was not observed to finish
successfully.
