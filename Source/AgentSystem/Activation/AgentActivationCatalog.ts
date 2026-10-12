import { deepFreeze } from "../Core/AgentDeepFreeze.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentPluginListEntry } from "../Plugins/AgentPluginTypes.js";
import type { AgentSkillCatalogItem } from "../Skills/AgentSkillCatalogProjector.js";
import type { AgentMcpActivationCatalogEntry } from "../McpPackages/AgentMcpPackageTypes.js";
import {
  normalizeAgentExplicitActivations,
  type AgentActivationCatalogEntry,
  type AgentActivationCatalogEntryData,
  type AgentActivationCatalogSnapshot,
  type AgentExplicitActivationSet,
} from "./AgentActivationTypes.js";

/**
 * Projects live Skills, Plugins, MCP servers, and user-facing System
 * extensions into the catalog exposed to the composer. Plugin-provided Skills
 * are intentionally represented by their parent Plugin so one activation
 * cannot silently drift into a partial scope.
 */
export function createAgentActivationCatalog(
  skills: readonly AgentSkillCatalogItem[],
  plugins: readonly AgentPluginListEntry[],
  mcpServers: readonly AgentMcpActivationCatalogEntry[],
  systemExtensions: readonly AgentActivationCatalogEntryData[],
): AgentActivationCatalogSnapshot {
  const pluginIds = new Set(plugins.map((plugin) => plugin.id));
  const entries = [
    ...skills
      .filter(
        (skill) =>
          !(
            skill.source.kind === "standalone" &&
            skill.source.id.startsWith("plugin:") &&
            pluginIds.has(skill.source.id.slice("plugin:".length))
          ),
      )
      .map((skill) => ({
        kind: "skill" as const,
        id: skill.name,
        revision: skill.revision,
        title: skill.title,
        description: skill.summary,
        ...(skill.icon ? { icon: skill.icon } : {}),
        enabled: true,
        selectable: true,
        source: skill.source.displayName,
      })),
    ...plugins.map((plugin) => ({
      kind: "plugin" as const,
      id: plugin.id,
      revision: plugin.revision,
      title: plugin.name,
      description: plugin.description ?? plugin.name,
      ...(plugin.icon ? { icon: plugin.icon } : {}),
      enabled: plugin.enabled,
      selectable: plugin.enabled && plugin.loaded && plugin.capabilityCount > 0,
      source: plugin.source,
    })),
    ...mcpServers.map((server) => ({
      kind: "mcp" as const,
      id: server.id,
      revision: server.revision,
      title: server.title,
      description: server.description,
      ...(server.localizedTitle ? { localizedTitle: server.localizedTitle } : {}),
      ...(server.localizedDescription ? { localizedDescription: server.localizedDescription } : {}),
      ...(server.icon ? { icon: server.icon } : {}),
      enabled: server.enabled,
      selectable: server.selectable,
      source: server.source,
    })),
    ...systemExtensions.map((extension) => ({
      kind: "system" as const,
      ...extension,
    })),
  ].sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  assertUniqueActivationEntries(entries);
  return deepFreeze({ revision: sha256HexOfCanonicalJson(entries), entries });
}

function assertUniqueActivationEntries(
  entries: readonly AgentActivationCatalogEntry[],
): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.id}`;
    if (seen.has(key)) throw new Error(`Activation catalog contains duplicate entry: ${key}.`);
    seen.add(key);
  }
}

/** Rejects stale, disabled, unknown, or revision-mismatched @ activations. */
export function assertAgentExplicitActivationsCurrent(
  activations: AgentExplicitActivationSet | undefined,
  catalog: AgentActivationCatalogSnapshot,
): void {
  if (!activations) return;
  const normalized = normalizeAgentExplicitActivations(activations);
  if (!normalized) return;
  if (normalized.catalogRevision !== catalog.revision) {
    throw new Error(
      `Activation catalog changed before execution (selected ${normalized.catalogRevision}, active ${catalog.revision}). Refresh the catalog and try again.`,
    );
  }
  const byKey = new Map(catalog.entries.map((entry) => [`${entry.kind}:${entry.id}`, entry]));
  for (const activation of normalized.explicit) {
    const entry = byKey.get(`${activation.kind}:${activation.id}`);
    if (!entry) throw new Error(`Explicit ${activation.kind} is not registered: ${activation.id}.`);
    if (!entry.enabled) {
      throw new Error(`Explicit ${activation.kind} is not enabled: ${activation.id}.`);
    }
    if (!entry.selectable) {
      throw new Error(`Explicit ${activation.kind} is not ready: ${activation.id}. Configure it before activation.`);
    }
    if (entry.revision !== activation.revision) {
      throw new Error(
        `Explicit ${activation.kind} revision changed before activation: ${activation.id} (selected ${activation.revision}, active ${entry.revision}).`,
      );
    }
  }
}
