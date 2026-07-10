import type { ToolResultPresentation } from "../../api/eventTypes";

/** Merges lifecycle and detail payloads without losing the richer projection. */
export function mergeToolResultPresentation(
  previous: ToolResultPresentation | undefined,
  next: ToolResultPresentation | undefined,
): ToolResultPresentation | undefined {
  if (!previous) return next;
  if (!next) return previous;

  return {
    ...previous,
    ...next,
    headline: next.headline || previous.headline,
    summary: next.summary ?? previous.summary,
    facts: next.facts.length > 0 ? next.facts : previous.facts,
    evidence: next.evidence.length > 0 ? next.evidence : previous.evidence,
    changes: next.changes.length > 0 ? next.changes : previous.changes,
    artifactUri: next.artifactUri ?? previous.artifactUri,
  };
}

export function readToolResultPresentation(value: unknown): ToolResultPresentation | undefined {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
  const presentation = record?.presentation;
  return presentation && typeof presentation === "object" && !Array.isArray(presentation)
    ? presentation as ToolResultPresentation
    : undefined;
}
