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
    changes: mergeChanges(previous.changes, next.changes),
    resources: mergeResourceReferences(previous.resources, next.resources),
    artifactUri: next.artifactUri ?? previous.artifactUri,
    workspaceObservation: next.workspaceObservation ?? previous.workspaceObservation,
    workspaceCheckpoint: next.workspaceCheckpoint ?? previous.workspaceCheckpoint,
    artifactAvailability: next.artifactAvailability ?? previous.artifactAvailability,
  };
}

function mergeChanges(
  previous: ToolResultPresentation["changes"],
  next: ToolResultPresentation["changes"],
): ToolResultPresentation["changes"] {
  const merged = new Map<string, ToolResultPresentation["changes"][number]>();
  for (const change of [...previous, ...next]) {
    if (!change?.kind || !change.key) continue;
    const identity = `${change.kind}\u0000${change.key}`;
    const current = merged.get(identity);
    merged.set(identity, current ? mergeChange(current, change) : change);
  }
  return [...merged.values()];
}

function mergeChange(
  previous: ToolResultPresentation["changes"][number],
  next: ToolResultPresentation["changes"][number],
): ToolResultPresentation["changes"][number] {
  return {
    ...previous,
    ...next,
    summary: next.summary || previous.summary,
    workspaceStatus: next.workspaceStatus ?? previous.workspaceStatus,
    addedLines: next.addedLines ?? previous.addedLines,
    removedLines: next.removedLines ?? previous.removedLines,
  };
}

function mergeResourceReferences(
  previous: ToolResultPresentation["resources"],
  next: ToolResultPresentation["resources"],
): ToolResultPresentation["resources"] {
  const merged = new Map<string, NonNullable<ToolResultPresentation["resources"]>[number]>();
  for (const resource of [...(previous ?? []), ...(next ?? [])]) {
    if (!resource?.uri) continue;
    const current = merged.get(resource.uri);
    merged.set(resource.uri, current ? mergeResourceReference(current, resource) : resource);
  }
  return merged.size > 0 ? [...merged.values()] : undefined;
}

function mergeResourceReference(
  previous: NonNullable<ToolResultPresentation["resources"]>[number],
  next: NonNullable<ToolResultPresentation["resources"]>[number],
): NonNullable<ToolResultPresentation["resources"]>[number] {
  return {
    ...previous,
    ...next,
    name: next.name || previous.name,
    mime: next.mime || previous.mime,
    ...(next.size === undefined && previous.size !== undefined ? { size: previous.size } : {}),
    ...(next.sha256 === undefined && previous.sha256 !== undefined ? { sha256: previous.sha256 } : {}),
  };
}

export function readToolResultPresentation(value: unknown): ToolResultPresentation | undefined {
  const record =
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  const presentation = record?.presentation;
  return presentation && typeof presentation === "object" && !Array.isArray(presentation)
    ? (presentation as ToolResultPresentation)
    : undefined;
}
