import fs from "node:fs";
import path from "node:path";
import { resolveConfigStoreConfig } from "../AgentDefaults.js";
import { AgentSystemConfigSchema } from "../Schemas/AgentSystemConfigSchema.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { isFileExistsError, writeFileAtomicSync } from "../Core/AgentFs.js";

export function resolveConfigStoreDatabasePath(workspaceRoot: string, config: AgentSystemConfig): string {
  const store = resolveConfigStoreConfig(config);
  return resolveConfigPath(workspaceRoot, store.DatabasePath);
}

export function resolveConfigPath(workspaceRoot: string, value: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(workspaceRoot, value);
}

export function writeAgentConfigJsonMirror(config: AgentSystemConfig, configPath: string): void {
  const normalized = AgentSystemConfigSchema.parse(config);
  writeFileAtomicSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`);
}

export function persistMigratedAgentConfigJson(
  config: AgentSystemConfig,
  configPath: string,
  sourceVersion: number,
): { backupPath?: string } {
  const backupPath = `${configPath}.v${sourceVersion}.bak`;
  let createdBackupPath: string | undefined;
  try {
    fs.copyFileSync(configPath, backupPath, fs.constants.COPYFILE_EXCL);
    createdBackupPath = backupPath;
  } catch (error) {
    if (!isFileExistsError(error)) {
      throw error;
    }
  }

  writeAgentConfigJsonMirror(config, configPath);
  return { backupPath: createdBackupPath };
}
