import fs from "node:fs";
import path from "node:path";
import type { AgentCliConfig } from "./Types.js";
import { AgentYamlFileLoader } from "./AgentYamlFileLoader.js";
import { AgentCliConfigSchema } from "./Schemas/AgentCliConfigSchema.js";

export class AgentCliConfigLoader {
  static load(configPath: string): AgentCliConfig {
    const absolutePath = path.resolve(configPath);
    return new AgentYamlFileLoader().load(absolutePath, AgentCliConfigSchema);
  }

  static loadIfExists(configPath: string): AgentCliConfig {
    const absolutePath = path.resolve(configPath);
    return fs.existsSync(absolutePath)
      ? this.load(absolutePath)
      : {};
  }
}
