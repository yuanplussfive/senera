import { uniqueTrimmed } from "./AgentMemoryCollections.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";

export function parseMemoryRowJsonObject(value: string): Record<string, unknown> {
  const parsed = parseJsonText(value, "Memory row JSON") as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

export function parseMemoryRowStringArray(value: string): string[] {
  const parsed = parseJsonText(value, "Memory row JSON") as unknown;
  return Array.isArray(parsed) ? uniqueTrimmed(parsed.filter((item): item is string => typeof item === "string")) : [];
}

export function parseMemoryRowNumberArray(value: string): number[] | undefined {
  const parsed = parseJsonText(value, "Memory row JSON") as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return undefined;
  }
  return parsed.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
}

export function readMemoryRowMetadataString(metadataJson: string, key: string): string {
  const value = parseMemoryRowJsonObject(metadataJson)[key];
  return typeof value === "string" ? value : "";
}
