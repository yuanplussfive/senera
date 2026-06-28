export function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function compactTokens(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0);
}

export function readStringToken(value: unknown): string | undefined {
  return readNonEmptyString(value);
}

export function readRequestHandle(value: unknown): string | undefined {
  const requestId = readNonEmptyString(value);
  return requestId ? requestId.replace(/_/g, ":") : undefined;
}

export function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
