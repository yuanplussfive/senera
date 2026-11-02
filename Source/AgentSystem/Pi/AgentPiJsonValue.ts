import type { JsonValue } from "@earendil-works/pi-ai";

/** Preserve JSON tool values while omitting optional object properties. */
export function projectAgentPiJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(projectAgentPiJsonValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, projectAgentPiJsonValue(entry)]),
    );
  }
  throw new Error("Pi tool boundary requires a JSON value.");
}
