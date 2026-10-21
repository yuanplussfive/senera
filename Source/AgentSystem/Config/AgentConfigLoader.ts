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
import { AgentConfigSecretCodec, type AgentConfigUnresolvedSecret } from "./AgentConfigSecretProtection.js";

export interface AgentConfigLoadResult {
  config: AgentSystemConfig;
  migration?: AgentConfigMigrationResult;
  secretsNeedPersistence: boolean;
  /** Secrets stored in this file that this host could not open. */
  unresolvedSecrets: readonly AgentConfigUnresolvedSecret[];
}

export interface AgentConfigLoadOptions {
  secretCodec: AgentConfigSecretCodec;
  onMigrationDetected?: (migration: {
    sourceVersion: number;
    targetVersion: number;
    secretsNeedPersistence: boolean;
  }) => void;
}

export class AgentConfigLoader {
  static load(configPath: string, secretCodec: AgentConfigSecretCodec): AgentSystemConfig {
    return this.loadWithMetadata(configPath, { secretCodec }).config;
  }

  static loadWithMetadata(configPath: string, options: AgentConfigLoadOptions): AgentConfigLoadResult {
    const absolutePath = path.resolve(configPath);
    const codec = options.secretCodec;
    let migration: AgentConfigMigrationResult | undefined;
    let secretsNeedPersistence = false;
    let unresolvedSecrets: readonly AgentConfigUnresolvedSecret[] = [];
    const config = new AgentJsonFileLoader().load(absolutePath, AgentSystemConfigSchema, (payload) => {
      const revealed = codec.revealPayload(payload);
      secretsNeedPersistence = revealed.plaintextSecretsFound || revealed.secretsNeedRewrap;
      unresolvedSecrets = revealed.unresolvedSecrets;
      const sourceVersion = readAgentConfigVersion(revealed.value);
      if (sourceVersion !== CurrentAgentConfigVersion) {
        options.onMigrationDetected?.({
          sourceVersion,
          targetVersion: CurrentAgentConfigVersion,
          secretsNeedPersistence,
        });
      } else if (secretsNeedPersistence) {
        options.onMigrationDetected?.({
          sourceVersion,
          targetVersion: CurrentAgentConfigVersion,
          secretsNeedPersistence: true,
        });
      }
      migration = migrateAgentConfigPayload(revealed.value);
      return migration?.config ?? revealed.value;
    });
    return { config, migration, secretsNeedPersistence, unresolvedSecrets };
  }
}
