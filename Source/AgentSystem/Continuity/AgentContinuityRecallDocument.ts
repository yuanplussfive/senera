import type { AgentContinuityObservation } from "./AgentContinuityDomain.js";

/**
 * Projects one persisted observation into the small searchable surface used by
 * the lexical index.  The full payload is never sent to MiniSearch as JSON:
 * only scalar keys and values become searchable metadata.  This keeps the
 * index useful for host-owned identities such as factKey and source refs while
 * avoiding accidental indexing of large tool payloads.
 */
export interface AgentContinuityRecallDocument {
  readonly id: string;
  readonly summary: string;
  readonly searchText: string;
  readonly metadata: string;
}

export function projectAgentContinuityRecallDocument(
  observation: AgentContinuityObservation,
): AgentContinuityRecallDocument {
  const metadata = new Set<string>([
    observation.id,
    observation.uri,
    observation.kind,
    observation.watermark,
    ...observation.sourceRefs,
  ]);
  collectSearchablePayloadMetadata(observation.payload, metadata);
  return {
    id: observation.uri,
    summary: observation.summary,
    searchText: observation.searchText ?? "",
    metadata: [...metadata].join("\n"),
  };
}

/**
 * Physical sources carry episode context (topic, session and request ids) in
 * their payload. Those fields identify the surrounding turn but are not text
 * evidence for the source itself; indexing them makes every source in one
 * episode look relevant to the same query. Keep source content searchable and
 * leave context joins to the episode window projection.
 */
function collectSearchablePayloadMetadata(value: unknown, output: Set<string>): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (record.kind === "physical_source") {
    for (const key of ["sourceKind", "toolName", "evidenceUri", "artifactUri"] as const) {
      collectScalarMetadata(record[key], output, key);
    }
    return;
  }
  collectScalarMetadata(value, output);
}

function collectScalarMetadata(value: unknown, output: Set<string>, key?: string): void {
  if (typeof value === "string") {
    if (key) output.add(key);
    output.add(value);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    if (key) output.add(key);
    output.add(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectScalarMetadata(item, output, key);
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      collectScalarMetadata(childValue, output, childKey);
    }
  }
}
