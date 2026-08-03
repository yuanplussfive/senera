/**
 * Returns a de-duplicated array of trimmed, non-empty strings.
 *
 * This is the single canonical implementation used across the codebase
 * (ActionPlanner, Pi, PiProxy, Artifacts, Safety, Loop). Consumers should
 * import from here rather than declaring local copies.
 */
export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/**
 * Removes entries whose values are `undefined`, empty strings, or empty arrays.
 *
 * This is the single canonical implementation used across the codebase
 * (ActionPlanner, PiProxy, Pi/SessionHistoryMaintenance). The Pi/Session
 * variant previously filtered only `undefined`; the stricter semantics here
 * are a safe superset.
 */
export function compactRecord<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, entry]) => entry !== undefined && entry !== "" && !(Array.isArray(entry) && entry.length === 0),
    ),
  );
}

/**
 * Returns the value as an array, or an empty array if it is not an array.
 */
export function readArrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Options for {@link readStringArray}.
 */
export interface ReadStringArrayOptions {
  /**
   * When `true`, remove duplicate strings (case-sensitive, first occurrence
   * wins). Default: `false`.
   */
  readonly deduplicate?: boolean;
  /**
   * When `true`, exclude strings that are empty or contain only whitespace.
   * Default: `false` (only non-string values are filtered; `""` and `"   "`
   * are preserved).
   */
  readonly rejectBlank?: boolean;
}

/**
 * Safely extracts an array of strings from an unknown value.
 *
 * Non-array input returns `[]`. Non-string elements are silently dropped.
 * Use {@link ReadStringArrayOptions} to control deduplication and blank
 * filtering.
 *
 * This is the single canonical implementation — replaces the 5 local copies
 * previously spread across Pi, PiProxy, Safety, ToolRuntime, and
 * SessionPersistence.
 */
export function readStringArray(value: unknown, options?: ReadStringArrayOptions): string[] {
  if (!Array.isArray(value)) return [];
  const deduplicate = options?.deduplicate ?? false;
  const rejectBlank = options?.rejectBlank ?? false;

  let result = value.filter((entry): entry is string => typeof entry === "string");
  if (rejectBlank) {
    result = result.filter((item) => item.trim().length > 0);
  }
  if (deduplicate) {
    result = [...new Set(result)];
  }
  return result;
}

export function groupAgentValuesBy<T>(values: Iterable<T>, identity: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = identity(value);
    const group = groups.get(key);
    if (group) group.push(value);
    else groups.set(key, [value]);
  }
  return groups;
}
