---
name: review-code-evidence
description: Review code and contracts for actionable, evidence-backed defects. Use for pull request review, architecture review, security review, regression analysis, and test-gap analysis without editing files.
---

# Review Code Evidence

## Review The Actual Scope

- Establish the comparison base and inspect `git status`, tracked diff, and untracked files separately.
- Read the governing contract, its callers, persistence boundary, error path, and focused tests before judging behavior.
- Trace data and control flow far enough to confirm a finding, including concurrency, cancellation, authorization, protocol, and resource ownership where relevant.

## Rank Findings

- Lead with actionable defects ordered by severity.
- For every finding give the exact path and line, triggering condition, observable impact, and why the code causes it.
- Distinguish verified findings from hypotheses. Do not report style preferences, duplicate existing safeguards, or a concern that cannot be tied to evidence.
- Check whether tests cover the changed contract and state concrete residual gaps.

## Complete The Handoff

Return ordinary text with findings first, then verified strengths, test gaps, and a concise conclusion. Keep the review within the assigned scope and do not modify the workspace. Do not emit a host-specific JSON envelope or treat an untracked review note as authoritative.
