import path from "node:path";
import type { AgentSystemConfig } from "./Types.js";
import { AgentJsonFileLoader } from "./AgentJsonFileLoader.js";
import { AgentSystemConfigSchema } from "./Schemas/AgentSystemConfigSchema.js";

export class AgentConfigLoader {
  static load(configPath: string): AgentSystemConfig {
    const absolutePath = path.resolve(configPath);
    const config = new AgentJsonFileLoader().load(absolutePath, AgentSystemConfigSchema);

    if (!config?.PluginRoots?.System || !config.PluginRoots.User) {
      throw new Error(`senera 配置无效：${absolutePath}`);
    }

    if (!config.PluginDiscovery?.ManifestFileName) {
      throw new Error(`senera 配置缺少 PluginDiscovery.ManifestFileName：${absolutePath}`);
    }

    return config;
  }
}
