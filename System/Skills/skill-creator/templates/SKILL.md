---
# Replace these values before publishing the package.
name: example-skill
description: Replace with one sentence that states the capability and the user request that activates it.
# Set true only for an operational Skill that must be selected explicitly with
# /example-skill; automatic model routing will then exclude it.
disable-model-invocation: false
metadata:
  senera:
    recommended-tools: []
---

# Example Skill

Replace this title and keep the body focused on one reusable workflow.

## When to use

State the user request or evidence that should activate this Skill. Include
important exclusions so semantic routing does not activate it for nearby work.

## Workflow

1. Read the current state and the relevant evidence.
2. Use only the registered tools named by the workflow.
3. Produce the requested result and preserve important evidence.

## Inputs

- List the inputs the workflow needs.
- Say how missing or ambiguous inputs are handled.

## Outputs

- Describe the user-visible result.
- Identify any Artifact, file, or evidence reference that must be returned.

## Constraints

- Keep permissions, workspace boundaries, and approval requirements explicit.
- Do not claim success without a verified tool result.

## Verification

Describe the smallest deterministic check that proves the workflow completed.

## Resources

List only package resources that actually exist, for example
`references/guide.md`, `scripts/check.mjs`, or `assets/example.png`.
