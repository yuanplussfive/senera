import { z } from "zod";

/** Plugin taxonomy. Kinds are advisory: they classify what the plugin extends,
 * not how it is loaded. */
export const AgentPluginKindValues = ["general", "memory", "context-engine", "model-providers"] as const;
export type AgentPluginKind = (typeof AgentPluginKindValues)[number];

/** Where a plugin was discovered. `bundled` plugins ship with the runtime and
 * are trusted by default; `user`/`project`/`pip` plugins require an opt-in
 * whitelist entry to load. */
export const AgentPluginSourceKinds = {
  Bundled: "bundled",
  User: "user",
  Project: "project",
  Pip: "pip",
} as const;
export type AgentPluginSourceKind = (typeof AgentPluginSourceKinds)[keyof typeof AgentPluginSourceKinds];

/** Manifest file name inside a plugin directory. */
export const AgentPluginManifestFileName = "senera.plugin.json";

export const AgentPluginManifestSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "Expected a lowercase kebab-case plugin id."),
    name: z.string().trim().min(1).max(128).optional(),
    version: z.string().trim().min(1).max(64),
    kind: z.enum(AgentPluginKindValues),
    description: z.string().trim().max(512).optional(),
    /** Module path relative to the plugin directory; must export `register`. */
    entry: z.string().trim().min(1).max(512),
    /** Plugin ids this plugin depends on; they must be enabled first. */
    requires: z.array(z.string().trim().min(1).max(128)).optional(),
  })
  .strict();

export type AgentPluginManifest = z.infer<typeof AgentPluginManifestSchema>;

export function assertAgentPluginManifest(value: unknown): AgentPluginManifest {
  return AgentPluginManifestSchema.parse(value);
}

export interface AgentPluginDescriptor {
  readonly manifest: AgentPluginManifest;
  readonly source: AgentPluginSourceKind;
  /** Absolute directory holding the manifest and entry module. */
  readonly directory: string;
  /** Bundled plugins ship with the runtime and are always trusted. */
  readonly builtin: boolean;
  /** Derived from the opt-in whitelist (`Plugins.Enabled`). */
  readonly enabled: boolean;
}

/** One discovered or loaded plugin, as shown by `senera plugins list`. */
export interface AgentPluginListEntry {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly kind: AgentPluginKind;
  readonly description?: string;
  readonly source: AgentPluginSourceKind;
  readonly builtin: boolean;
  readonly enabled: boolean;
  readonly directory: string;
  readonly requires: readonly string[];
  /** Whether the plugin loaded successfully; false when skipped or failed. */
  readonly loaded: boolean;
  /** Load failure message, present only when loading was attempted and failed. */
  readonly error?: string;
}

/** Deterministic load failure for one plugin; never aborts the host. */
export interface AgentPluginLoadError {
  readonly pluginId: string;
  readonly message: string;
}
