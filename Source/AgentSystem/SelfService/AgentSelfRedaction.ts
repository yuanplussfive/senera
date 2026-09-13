/** Secret redaction for self-service output. Model-visible config snapshots
 * must never echo ApiKey/AppSecret/token values back into the conversation. */

import { isAgentConfigSensitiveFieldName } from "../Config/AgentConfigSecretContract.js";

const SecretEnvelopePrefix = "senera:secret:v1:";
const ProtocolSecretKeyNames = new Set(["authorization", "privatekey"]);

const Redacted = "***";

/** Deep-clones and redacts secrets in one pass; the original is untouched. */
export function projectAgentSelfRedacted(value: unknown, maxDepth = 12, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > maxDepth) return Redacted;
  if (Array.isArray(value)) {
    return value.map((entry) => projectAgentSelfRedacted(entry, maxDepth, depth + 1));
  }
  if (typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isAgentSelfSensitiveKey(key)) {
      output[key] = Redacted;
      continue;
    }
    if (typeof entry === "string" && isAgentSelfSecretValue(entry)) {
      output[key] = maskSecretString();
      continue;
    }
    output[key] = projectAgentSelfRedacted(entry, maxDepth, depth + 1);
  }
  return output;
}

function maskSecretString(): string {
  return Redacted;
}

export function isAgentSelfSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
  return isAgentConfigSensitiveFieldName(key) || ProtocolSecretKeyNames.has(normalized);
}

function isAgentSelfSecretValue(value: string): boolean {
  const normalized = value.trim();
  return isSecretEnvelope(normalized) || isBearerCredential(normalized);
}

function isSecretEnvelope(value: string): boolean {
  const marker = value.indexOf(SecretEnvelopePrefix);
  return marker >= 0 && value.length > marker + SecretEnvelopePrefix.length;
}

function isBearerCredential(value: string): boolean {
  if (value.slice(0, 6).toLowerCase() !== "bearer") return false;
  if (value.slice(6, 7).trim() !== "") return false;
  return value.slice(7).trim().length > 0;
}

export const AgentSelfRedactedMarker = Redacted;
