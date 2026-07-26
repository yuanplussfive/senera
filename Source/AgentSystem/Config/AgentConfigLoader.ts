import path from "node:path";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentJsonFileLoader } from "./AgentJsonFileLoader.js";
import { AgentSystemConfigSchema } from "../Schemas/AgentSystemConfigSchema.js";
import { migrateAgentConfigPayload, type AgentConfigMigrationResult } from "./AgentConfigMigration.js";
import { AgentConfigSecretCodec } from "./AgentConfigSecretProtection.js";

export interface AgentConfigLoadResult {
  config: AgentSystemConfig;
  migration?: AgentConfigMigrationResult;
  secretsNeedPersistence: boolean;
}

export class AgentConfigLoader {
  static load(configPath: string, secretCodec?: AgentConfigSecretCodec): AgentSystemConfig {
    return this.loadWithMetadata(configPath, secretCodec).config;
  }

  static loadWithMetadata(configPath: string, secretCodec?: AgentConfigSecretCodec): AgentConfigLoadResult {
    const absolutePath = path.resolve(configPath);
    const codec = secretCodec ?? new AgentConfigSecretCodec({ workspaceRoot: path.dirname(absolutePath) });
    let migration: AgentConfigMigrationResult | undefined;
    let secretsNeedPersistence = false;
    const config = new AgentJsonFileLoader().load(absolutePath, AgentSystemConfigSchema, (payload) => {
      const revealed = codec.revealPayload(payload);
      secretsNeedPersistence = revealed.plaintextSecretsFound;
      migration = migrateAgentConfigPayload(revealed.value);
      return migration?.config ?? revealed.value;
    });
    return { config, migration, secretsNeedPersistence };
  }
}
