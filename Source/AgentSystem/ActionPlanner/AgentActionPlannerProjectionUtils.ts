import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";
import { compactRecord, readArrayValue, uniqueStrings } from "../Core/AgentCollections.js";

export {
  readAgentTrimmedString as readString,
  readAgentUnknownRecord as readRecord,
} from "../Core/AgentUnknownValue.js";

export function readArrayItems(value: unknown, itemKey: string): unknown[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const item = (value as Record<string, unknown>)[itemKey];
  return Array.isArray(item) ? item : item !== undefined ? [item] : [];
}

export { compactRecord as compactObject, uniqueStrings, readArrayValue as readArray };

export function stringifyPreview(value: unknown): string {
  return typeof value === "string" ? value : stableStringify(value);
}

export function stableStringify(value: unknown): string {
  // 委托规范 JSON（码点排序）：localeCompare 排序会随 ICU 环境漂移，不能用于哈希与身份键。
  return value === undefined ? "null" : stringifyAgentCanonicalJson(value);
}
