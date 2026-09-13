/** Secret redaction for self-service output. Model-visible config snapshots
 * must never echo ApiKey/AppSecret/token values back into the conversation. */

const SecretValuePatterns = [/senera:secret:v1:/u, /bots\.qq\.com/u, /^Bearer\s+\S+/iu];
const SensitiveKeyNames = new Set([
  "apikey",
  "appsecret",
  "clientsecret",
  "webhooksecret",
  "token",
  "bottoken",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "xapikey",
  "credential",
  "password",
  "privatekey",
  "secret",
]);

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
    if (typeof entry === "string" && SecretValuePatterns.some((pattern) => pattern.test(entry))) {
      output[key] = maskSecretString(entry);
      continue;
    }
    output[key] = projectAgentSelfRedacted(entry, maxDepth, depth + 1);
  }
  return output;
}

function maskSecretString(value: string): string {
  if (value.length <= 12) return Redacted;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function isAgentSelfSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
  return (
    SensitiveKeyNames.has(normalized) || /(?:api)?key|secret|token|credential|password|authorization/iu.test(normalized)
  );
}

export const AgentSelfRedactedMarker = Redacted;
