import fs from "node:fs";
import path from "node:path";
import { resolveFrom } from "./AgentPath.js";
import type { AgentSystemConfig, LoadedPlugin, PluginManifest } from "./Types.js";
import { AgentJsonFileLoader } from "./AgentJsonFileLoader.js";
import { PluginManifestSchema } from "./Schemas/PluginManifestSchema.js";

export class AgentPluginScanner {
  constructor(
    private readonly workspaceRoot: string,
    private readonly config: AgentSystemConfig,
  ) {}

  scan(): LoadedPlugin[] {
    const pluginRoots = [
      ...this.config.PluginRoots.System,
      ...this.config.PluginRoots.User,
    ];

    const plugins: LoadedPlugin[] = [];

    for (const pluginRoot of pluginRoots) {
      const absoluteRoot = resolveFrom(this.workspaceRoot, pluginRoot);
      if (!fs.existsSync(absoluteRoot)) {
        continue;
      }

      for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }

        const rootPath = path.join(absoluteRoot, entry.name);
        const manifestFileName = this.config.PluginDiscovery?.ManifestFileName;
        if (!manifestFileName) {
          throw new Error("senera 配置缺少 PluginDiscovery.ManifestFileName。");
        }

        const manifestPath = path.join(rootPath, manifestFileName);

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
          manifestPath,
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
