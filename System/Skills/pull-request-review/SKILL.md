---
name: pull-request-review
description: Review a pull request, commit, merge, local diff, or uncommitted changes for bugs, regressions, security risks, data loss, concurrency or cancellation issues, maintainability problems, and missing tests. Use when the user asks for code review, change risk, framework impact, or readiness to merge or commit. 适用于代码审查、检查提交或差异、评估回归和安全风险、发现缺失测试，以及判断能否合并或提交。
---

# Pull Request Review

1. Establish the exact change scope and read the diff plus surrounding ownership context.
2. Prioritize behavioral regressions, data loss, security, concurrency, cancellation, and test gaps.
3. Ground every finding in a file location and a concrete failure mode.
4. Match verification recommendations to the actual risk.
5. Lead with findings ordered by severity; state clearly when no issue is found.
6. Mention residual risk and checks that were not run.
