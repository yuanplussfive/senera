import type { ToolArtifactPolicyManifest } from "../Types/PluginManifestTypes.js";

export function redactArtifactSecrets(value: unknown, policy: ToolArtifactPolicyManifest | undefined): unknown {
  const keyPatterns = (policy?.Redact?.Keys ?? []).map((pattern) => new RegExp(pattern, "i"));
  const pathSelectors = new Set(policy?.Redact?.Paths ?? []);
  return redactValue(value, keyPatterns, pathSelectors, "$");
}

function redactValue(
  value: unknown,
  keyPatterns: readonly RegExp[],
  pathSelectors: ReadonlySet<string>,
  currentPath: string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) => redactValue(entry, keyPatterns, pathSelectors, `${currentPath}[${index}]`));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${currentPath}.${key}`;
    redacted[key] =
      isSensitiveKey(key, keyPatterns) || pathSelectors.has(childPath)
        ? "[REDACTED]"
        : redactValue(entry, keyPatterns, pathSelectors, childPath);
  }
  return redacted;
}

function isSensitiveKey(key: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(key));
}
