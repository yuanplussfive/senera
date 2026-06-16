import fs from "node:fs";
import path from "node:path";
import { resolveFrom } from "./AgentPath.js";
import type {
  AgentSystemConfig,
  LoadedPlugin,
  PluginManifest,
  PluginRootKind,
} from "./Types.js";
import { AgentJsonFileLoader } from "./AgentJsonFileLoader.js";
import { PluginManifestSchema } from "./Schemas/PluginManifestSchema.js";
import { readLoadedPluginConfig } from "./AgentPluginConfig.js";
import {
  resolvePluginDiscoveryConfig,
  resolvePluginRootsConfig,
} from "./AgentDefaults.js";

export class AgentPluginScanner {
  constructor(
    private readonly workspaceRoot: string,
    private readonly config: AgentSystemConfig,
  ) {}

  scan(): LoadedPlugin[] {
    const roots = resolvePluginRootsConfig(this.config);
    const discovery = resolvePluginDiscoveryConfig(this.config);
    const pluginRoots: Array<{ kind: PluginRootKind; path: string }> = [
      ...roots.System.map((pluginRoot) => ({
        kind: "System" as const,
        path: pluginRoot,
      })),
      ...roots.User.map((pluginRoot) => ({
        kind: "User" as const,
        path: pluginRoot,
      })),
    ];

    const plugins: LoadedPlugin[] = [];

    for (const pluginRoot of pluginRoots) {
      const absoluteRoot = resolveFrom(this.workspaceRoot, pluginRoot.path);
      if (!fs.existsSync(absoluteRoot)) {
        continue;
      }

      for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }

        const rootPath = path.join(absoluteRoot, entry.name);
        const manifestPath = path.join(rootPath, discovery.ManifestFileName);

        if (!fs.existsSync(manifestPath)) {
          continue;
        }

        const manifest = new AgentJsonFileLoader().load(
          manifestPath,
          PluginManifestSchema,
        ) as PluginManifest;
        this.assertManifest(manifest, manifestPath);

        plugins.push({
          rootPath,
          rootKind: pluginRoot.kind,
          manifestPath,
          config: readLoadedPluginConfig(rootPath, this.config),
          manifest,
        });
      }
    }

    return plugins.sort((a, b) =>
      a.manifest.Plugin.Name.localeCompare(b.manifest.Plugin.Name),
    );
  }

  private assertManifest(manifest: PluginManifest, manifestPath: string): void {
    if (!manifest?.Plugin?.Name || !manifest.Plugin.Version || !manifest.Plugin.Kind) {
      throw new Error(`插件声明无效：${manifestPath}`);
    }
  }
}
