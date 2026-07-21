import fs from "node:fs";
import path from "node:path";
import { resolveConfigStoreConfig } from "../AgentDefaults.js";
import { AgentSystemConfigSchema } from "../Schemas/AgentSystemConfigSchema.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";

export function resolveConfigStoreDatabasePath(workspaceRoot: string, config: AgentSystemConfig): string {
  const store = resolveConfigStoreConfig(config);
  return resolveConfigPath(workspaceRoot, store.DatabasePath);
}

export function resolveConfigPath(workspaceRoot: string, value: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(workspaceRoot, value);
}

export function writeAgentConfigJsonMirror(config: AgentSystemConfig, configPath: string): void {
  const normalized = AgentSystemConfigSchema.parse(config);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, configPath);
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
    if (!isAlreadyExistsError(error)) {
      throw error;
    }
  }

  writeAgentConfigJsonMirror(config, configPath);
  return { backupPath: createdBackupPath };
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
