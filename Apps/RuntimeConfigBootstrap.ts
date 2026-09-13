import fs from "node:fs";
import path from "node:path";
import { loadConfigFile, type AgentConfigSourceOptions } from "../Source/AgentSystem/Config/AgentConfigService.js";
import { writeAgentConfigJsonMirror } from "../Source/AgentSystem/Config/AgentConfigServicePaths.js";
import { errorMessage } from "../Source/AgentSystem/Core/AgentErrors.js";

const RuntimeConfigFileName = "senera.config.json";
const RuntimeConfigTemplateFileName = "senera.config.example.json";

export interface RuntimeConfigSeedOptions {
  configPath: string;
  templatePath: string;
}

export function seedRuntimeConfigForSource(source: AgentConfigSourceOptions, resourceRoot: string): void {
  if (source.kind !== "json") return;
  try {
    ensureRuntimeConfigFile({
      configPath: source.configPath,
      templatePath: path.join(resourceRoot, RuntimeConfigTemplateFileName),
    });
  } catch (error) {
    throw new Error(`Failed to seed workspace config at ${source.configPath}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
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
