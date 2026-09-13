import fs from "node:fs";
import path from "node:path";
import {
  AgentPluginManifestFileName,
  AgentPluginManifestSchema,
  type AgentPluginDescriptor,
  type AgentPluginSourceKind,
} from "./AgentPluginTypes.js";

export interface AgentPluginDiscoverySource {
  readonly source: AgentPluginSourceKind;
  readonly directory: string;
}

export interface AgentPluginDiscoveryError {
  readonly source: AgentPluginSourceKind;
  readonly directory: string;
  readonly pluginId?: string;
  readonly message: string;
}

export interface AgentPluginDiscoveryResult {
  readonly plugins: readonly AgentPluginDescriptor[];
  readonly errors: readonly AgentPluginDiscoveryError[];
}

/** Scans each source directory for subdirectories carrying a
 * `senera.plugin.json` manifest. Invalid or duplicate manifests are reported
 * as errors and skipped — discovery never throws, so one broken third-party
 * plugin cannot take the runtime down. First source wins on duplicate ids:
 * bundled > user > project > pip. */
export function discoverAgentPlugins(sources: readonly AgentPluginDiscoverySource[]): AgentPluginDiscoveryResult {
  const plugins: AgentPluginDescriptor[] = [];
  const errors: AgentPluginDiscoveryError[] = [];
  const seenIds = new Set<string>();

  for (const source of sources) {
    if (!fs.existsSync(source.directory)) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(source.directory, { withFileTypes: true });
    } catch (error) {
      errors.push({
        source: source.source,
        directory: source.directory,
        message: `Cannot read plugin directory: ${errorMessage(error)}`,
      });
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(source.directory, entry.name);
      const manifestPath = path.join(directory, AgentPluginManifestFileName);
      if (!fs.existsSync(manifestPath)) continue;

      const parsed = readAgentPluginManifest(manifestPath);
      if (!parsed.ok) {
        errors.push({ source: source.source, directory, message: parsed.error });
        continue;
      }
      const manifest = parsed.value;
      if (seenIds.has(manifest.id)) {
        errors.push({
          source: source.source,
          directory,
          pluginId: manifest.id,
          message: `Duplicate plugin id, first source wins: ${manifest.id}`,
        });
        continue;
      }
      seenIds.add(manifest.id);
      plugins.push({
        manifest,
        source: source.source,
        directory,
        builtin: source.source === "bundled",
        enabled: false,
      });
    }
  }

  return { plugins, errors };
}

function readAgentPluginManifest(
  manifestPath: string,
):
  | { readonly ok: true; readonly value: ReturnType<typeof AgentPluginManifestSchema.parse> }
  | { readonly ok: false; readonly error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return { ok: false, error: `Invalid plugin manifest JSON: ${errorMessage(error)}` };
  }
  const parsed = AgentPluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: zippedManifestIssues(parsed.error) };
  }
  return { ok: true, value: parsed.data };
}

function zippedManifestIssues(error: {
  issues: readonly { path: readonly (string | number | symbol)[]; message: string }[];
}): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("; ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
