import path from "node:path";
import type { AgentSystemConfig } from "./Types.js";
import { AgentJsonFileLoader } from "./AgentJsonFileLoader.js";
import { AgentSystemConfigSchema } from "./Schemas/AgentSystemConfigSchema.js";

export class AgentConfigLoader {
  static load(configPath: string): AgentSystemConfig {
    const absolutePath = path.resolve(configPath);
    return new AgentJsonFileLoader().load(absolutePath, AgentSystemConfigSchema);
  }
}
