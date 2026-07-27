import path from "node:path";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentJsonFileLoader } from "./AgentJsonFileLoader.js";
import { AgentSystemConfigSchema } from "../Schemas/AgentSystemConfigSchema.js";
import {
  migrateAgentConfigPayload,
  readAgentConfigVersion,
  type AgentConfigMigrationResult,
} from "./AgentConfigMigration.js";
import { CurrentAgentConfigVersion } from "./AgentConfigVersion.js";

export interface AgentConfigLoadResult {
  config: AgentSystemConfig;
  migration?: AgentConfigMigrationResult;
}

export class AgentConfigLoader {
  static load(configPath: string): AgentSystemConfig {
    return this.loadWithMetadata(configPath).config;
  }

  static loadWithMetadata(
    configPath: string,
    onMigrationDetected?: (migration: { sourceVersion: number; targetVersion: number }) => void,
  ): AgentConfigLoadResult {
    const absolutePath = path.resolve(configPath);
    let migration: AgentConfigMigrationResult | undefined;
    const config = new AgentJsonFileLoader().load(absolutePath, AgentSystemConfigSchema, (payload) => {
      const sourceVersion = readAgentConfigVersion(payload);
      if (sourceVersion !== CurrentAgentConfigVersion) {
        onMigrationDetected?.({ sourceVersion, targetVersion: CurrentAgentConfigVersion });
      }
      migration = migrateAgentConfigPayload(payload);
      return migration?.config ?? payload;
    });
    return { config, migration };
  }
}
