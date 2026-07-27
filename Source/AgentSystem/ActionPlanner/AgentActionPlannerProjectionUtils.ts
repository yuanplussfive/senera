import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";

export function readArrayItems(value: unknown, itemKey: string): unknown[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const item = (value as Record<string, unknown>)[itemKey];
  return Array.isArray(item) ? item : item !== undefined ? [item] : [];
}

export function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, entry]) => entry !== undefined && entry !== "" && !(Array.isArray(entry) && entry.length === 0),
    ),
  );
}

export function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function stringifyPreview(value: unknown): string {
  return typeof value === "string" ? value : stableStringify(value);
}

export function stableStringify(value: unknown): string {
  // 委托规范 JSON（码点排序）：localeCompare 排序会随 ICU 环境漂移，不能用于哈希与身份键。
  return value === undefined ? "null" : stringifyAgentCanonicalJson(value);
}
