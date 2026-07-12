import type { ConfigFormFieldData, ConfigFormFieldOptionValue } from "../../api/eventTypes";

export type JsonConfigObject = Record<string, unknown>;

export function writeJsonConfigFieldValue(
  document: JsonConfigObject,
  pathParts: readonly string[],
  value: unknown,
): JsonConfigObject {
  const clone = cloneJsonValue(document) as JsonConfigObject;
  setValueAtPath(clone, pathParts, value);
  return clone;
}

export function readDraftOrEffectiveValue(value: JsonConfigObject, field: ConfigFormFieldData): unknown {
  const draftValue = readValueAtPath(value, field.path);
  return draftValue === undefined ? field.effectiveValue : draftValue;
}

export function normalizeFieldValue(field: ConfigFormFieldData, value: unknown): unknown {
  if (field.type === "boolean") {
    return Boolean(value);
  }
  if (field.type === "number") {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }
  if (field.type === "array") {
    return Array.isArray(value)
      ? value.map((item) =>
          field.itemType === "table" ? (isRecord(item) ? item : {}) : coerceArrayItem(item, field.itemType ?? "string"),
        )
      : [];
  }
  if (field.type === "record") {
    return isRecord(value) ? value : {};
  }
  if (field.type === "string") {
    return String(value ?? "");
  }
  return value;
}

export function readValueAtPath(source: unknown, pathParts: readonly string[]): unknown {
  let current = source;
  for (const part of pathParts) {
    current = isRecord(current) ? current[part] : undefined;
  }
  return current;
}

export function readRelativeItemPath(parentPath: readonly string[], childPath: readonly string[]): string[] {
  return childPath.slice(parentPath.length);
}

export function readArrayItemTitle(field: ConfigFormFieldData, record: Record<string, unknown>, index: number): string {
  const title = field.itemLabelPath ? readValueAtPath(record, field.itemLabelPath) : undefined;
  if (typeof title === "string" && title.trim()) {
    return title;
  }
  const id = readValueAtPath(record, ["Id"]);
  if (typeof id === "string" && id.trim()) {
    return id;
  }
  return `${field.label} ${index + 1}`;
}

export function coerceArrayItem(value: unknown, itemType: string): unknown {
  if (itemType === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (itemType === "boolean") {
    return Boolean(value);
  }
  return String(value ?? "");
}

export function defaultArrayItem(itemType: string): unknown {
  if (itemType === "number") {
    return 0;
  }
  if (itemType === "boolean") {
    return false;
  }
  if (itemType === "record" || itemType === "table") {
    return {};
  }
  return "";
}

export function optionLabel(field: ConfigFormFieldData, option: ConfigFormFieldOptionValue): string {
  return field.optionLabels?.[String(option)] ?? String(option);
}

export function sameOptionValue(left: unknown, right: ConfigFormFieldOptionValue): boolean {
  return String(left) === String(right);
}

export function readNumberDraftCommitValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || isIncompleteNumberDraft(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readNumberDraftBlurValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-" || trimmed === "+") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function cloneJsonValue(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function isRecord(value: unknown): value is JsonConfigObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function setValueAtPath(document: JsonConfigObject, pathParts: readonly string[], value: unknown): void {
  const lastKey = pathParts[pathParts.length - 1];
  if (!lastKey) {
    return;
  }

  let current: JsonConfigObject = document;
  for (const part of pathParts.slice(0, -1)) {
    const next = current[part];
    if (!isRecord(next)) {
      current[part] = {};
    }
    current = current[part] as JsonConfigObject;
  }
  current[lastKey] = value;
}

function isIncompleteNumberDraft(value: string): boolean {
  return value === "-" || value === "+" || value.endsWith(".") || /[eE][+-]?$/.test(value);
}
