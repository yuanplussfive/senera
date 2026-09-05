import fs from "node:fs";
import path from "node:path";
import { loadConfigFile } from "../Source/AgentSystem/Config/AgentConfigService.js";
import { writeAgentConfigJsonMirror } from "../Source/AgentSystem/Config/AgentConfigServicePaths.js";

const RuntimeConfigFileName = "senera.config.json";
const RuntimeConfigTemplateFileName = "senera.config.example.json";

export interface RuntimeConfigSeedOptions {
  configPath: string;
  templatePath: string;
}

export function ensureRuntimeConfigFile(options: RuntimeConfigSeedOptions): void {
  if (fs.existsSync(options.configPath)) return;
  writeAgentConfigJsonMirror(loadConfigFile(options.templatePath), options.configPath);
}

export function ensureSeneraDevelopmentConfig(workspaceRoot: string): string {
  const configPath = resolveSeneraServerConfigPath(workspaceRoot);
  ensureRuntimeConfigFile({
    configPath,
    templatePath: path.resolve(workspaceRoot, RuntimeConfigTemplateFileName),
  });
  return configPath;
}

export function resolveSeneraServerConfigPath(workspaceRoot: string): string {
  const configured = process.env.AGENT_CONFIG_PATH?.trim();
  return path.resolve(workspaceRoot, configured || RuntimeConfigFileName);
}
