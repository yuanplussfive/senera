export type AgentUnknownRecord = Record<string, unknown>;

export function isAgentUnknownRecord(value: unknown): value is AgentUnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readAgentUnknownRecord(value: unknown): AgentUnknownRecord | undefined {
  return isAgentUnknownRecord(value) ? value : undefined;
}

/**
 * Like {@link readAgentUnknownRecord} but throws with a contextual message
 * when `value` is not a record. Use this in validation paths where a
 * non-record input is a programmer error or protocol violation.
 *
 * Replaces local `readRecord(value, label)` copies in
 * `AgentVectorModelClient` and `AgentToolResourceArgumentProjector`.
 */
export function readAgentRecordOrThrow(value: unknown, label: string): AgentUnknownRecord {
  if (!isAgentUnknownRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

export function agentUnknownRecordOrEmpty(value: unknown): AgentUnknownRecord {
  return readAgentUnknownRecord(value) ?? {};
}

export function readAgentString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Returns the value as a string if it is a non-empty string (length > 0).
 *
 * **Note:** This allows whitespace-only strings like `"   "` — it only
 * rejects `""`. For most use cases where whitespace-only strings should also
 * be excluded, prefer {@link readAgentNonBlankString} instead.
 */
export function readAgentNonEmptyString(value: unknown): string | undefined {
  const text = readAgentString(value);
  return text && text.length > 0 ? text : undefined;
}

/**
 * Returns the value as a string if it is a non-blank string (contains at
 * least one non-whitespace character).
 *
 * This is stricter than {@link readAgentNonEmptyString}: it rejects both `""`
 * and `"   "`. Prefer this in most input-reading contexts.
 */
export function readAgentNonBlankString(value: unknown): string | undefined {
  const text = readAgentString(value);
  return text && text.trim().length > 0 ? text : undefined;
}

export function readAgentTrimmedString(value: unknown): string | undefined {
  return readAgentNonBlankString(value)?.trim();
}

export function agentStringOrEmpty(value: unknown): string {
  return readAgentString(value) ?? "";
}
