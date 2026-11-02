import type { AgentMcpPackageToolLocalization } from "./AgentMcpPackageTypes.js";

/** Namespaced metadata owned by the MCP package manifest. */
export const AgentMcpToolLocalizationMetadataKey = "ai.senera/tool-i18n";

/**
 * MCP producers are free to choose identifier casing and separators. Search
 * metadata must follow the same identity, otherwise a valid declaration can
 * silently lose its localized retrieval vocabulary.
 */
export function canonicalMcpToolIdentity(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, "");
}

export function resolveMcpToolLocalization(
  localization: AgentMcpPackageToolLocalization | undefined,
  toolName: string,
): readonly string[] {
  if (!localization) return [];
  const identity = canonicalMcpToolIdentity(toolName);
  const matches = Object.entries(localization).filter(
    ([declaredName]) => canonicalMcpToolIdentity(declaredName) === identity,
  );
  if (matches.length > 1) {
    throw new Error(
      `MCP tool localization keys are ambiguous for ${toolName}: ${matches.map(([name]) => name).join(", ")}.`,
    );
  }
  return matches[0]?.[1] ?? [];
}

export function validateMcpToolLocalization(
  localization: AgentMcpPackageToolLocalization | undefined,
  toolNames: readonly string[],
): void {
  if (!localization) return;
  const declaredIdentities = new Map<string, string>();
  for (const toolName of toolNames) {
    const identity = canonicalMcpToolIdentity(toolName);
    const previous = declaredIdentities.get(identity);
    if (previous && previous !== toolName) {
      throw new Error(`MCP tool declarations have the same normalized identity: ${previous}, ${toolName}.`);
    }
    declaredIdentities.set(identity, toolName);
  }
  for (const declaredName of Object.keys(localization)) {
    if (!declaredIdentities.has(canonicalMcpToolIdentity(declaredName))) {
      throw new Error(`MCP tool localization has no matching declaration: ${declaredName}.`);
    }
  }
}
