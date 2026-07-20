import crypto from "node:crypto";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";

const AgentRuntimePreparationFingerprintVersion = 1;

export function createAgentRuntimePreparationFingerprint(input: {
  config: AgentSystemConfig;
  modelProviderId?: string;
  sourceRevisions?: Readonly<Record<string, string | number>>;
}): string {
  const payload = stableJson({
    version: AgentRuntimePreparationFingerprintVersion,
    modelProviderId: input.modelProviderId?.trim() || null,
    sourceRevisions: input.sourceRevisions ?? {},
    config: input.config,
  });
  const digest = crypto.createHash("sha256").update(payload).digest("hex");
  return `preparation-v${AgentRuntimePreparationFingerprintVersion}:${digest}`;
}

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((entry) => (entry === undefined ? "null" : stableJson(entry))).join(",")}]`;
  }

  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number": {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) throw new TypeError("Preparation fingerprint cannot encode a non-finite number.");
      return serialized;
    }
    case "object":
      return `{${Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => compareCodePoints(left, right))
        .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
        .join(",")}}`;
    default:
      throw new TypeError(`Preparation fingerprint cannot encode ${typeof value}.`);
  }
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
