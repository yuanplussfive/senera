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
