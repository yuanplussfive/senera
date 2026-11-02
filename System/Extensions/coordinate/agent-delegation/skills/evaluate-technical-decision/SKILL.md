---
name: evaluate-technical-decision
description: Evaluate engineering choices and their tradeoffs. Use for architecture decisions, dependency selection, runtime strategy, performance and security tradeoffs, and deciding between competing implementation paths.
---

# Evaluate Technical Decision

## Frame The Decision

- State the decision, the user-visible outcome, non-negotiable constraints, and the evidence already available.
- Verify the premises in code, contracts, measurements, or primary sources before comparing options.
- Treat each option as a complete operating path, including ownership, failure handling, migration, observability, and maintenance.

## Compare And Recommend

- Compare correctness, security, latency, complexity, operability, portability, and reversibility as applicable to the decision.
- Distinguish facts from assumptions and reversible experiments from durable commitments.
- Recommend the narrowest option that satisfies the actual constraints, explain the decisive tradeoffs, and state why the main alternatives are rejected.
- Name the evidence or decision that would change the recommendation.

## Complete The Handoff

Return ordinary text with the recommendation first, followed by evidence, tradeoffs, rejected alternatives, implementation implications, and unresolved decisions. Do not create a second decision hierarchy, modify files, or invent a machine-readable output contract.
