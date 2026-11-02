export type UnknownRecord = Record<string, unknown>;

export function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readUnknownRecord(value: unknown): UnknownRecord | undefined {
  return isUnknownRecord(value) ? value : undefined;
}

export function unknownRecordOrEmpty(value: unknown): UnknownRecord {
  return readUnknownRecord(value) ?? {};
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function readNonBlankString(value: unknown): string | undefined {
  const text = readString(value);
  return text && text.trim().length > 0 ? text : undefined;
}

export function readTrimmedString(value: unknown): string | undefined {
  return readNonBlankString(value)?.trim();
}
