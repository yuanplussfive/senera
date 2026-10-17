/** Shared wire contract for the workspace-owned Markdown prompt preset. */
export const AgentPromptPresetStateDirectoryName = ".senera";
export const AgentPromptPresetStateFileName = "prompt-preset.json";
export const AgentPromptPresetStatePath = `${AgentPromptPresetStateDirectoryName}/${AgentPromptPresetStateFileName}`;
/** Workspace-local directory that owns user-authored prompt preset documents. */
export const AgentPromptPresetDirectoryName = "prompts";
export const AgentPromptPresetDirectoryPath = AgentPromptPresetDirectoryName;
export const AgentPromptPresetFileExtension = ".md";
export const AgentPromptPresetManifestVersion = 1;

export interface AgentPromptPresetManifest {
  readonly version: typeof AgentPromptPresetManifestVersion;
  readonly activePath: string;
  /** Explicitly controls whether the selected document is injected into new turns. */
  readonly enabled: boolean;
}

/**
 * Parses the persisted prompt-preset state at the contract boundary.
 *
 * Version 1 records written before the enable switch existed omit `enabled`.
 * They are intentionally upgraded to the historical behavior (enabled) when
 * read, and every subsequent UI mutation writes the complete shape.
 */
export function parseAgentPromptPresetManifest(value: unknown): AgentPromptPresetManifest | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.version !== AgentPromptPresetManifestVersion || typeof record.activePath !== "string") return undefined;
  const enabled = record.enabled === undefined ? true : record.enabled;
  if (typeof enabled !== "boolean") return undefined;
  return {
    version: AgentPromptPresetManifestVersion,
    activePath: record.activePath,
    enabled,
  };
}
