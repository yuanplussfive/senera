import fs from "node:fs";
import path from "node:path";
import { loadConfigFile, type AgentConfigSourceOptions } from "../Source/AgentSystem/Config/AgentConfigService.js";
import { writeAgentConfigJsonMirror } from "../Source/AgentSystem/Config/AgentConfigServicePaths.js";
import { AgentConfigSecretCodec } from "../Source/AgentSystem/Config/AgentConfigSecretProtection.js";
import { errorMessage } from "../Source/AgentSystem/Core/AgentErrors.js";
import {
  AgentWorkspaceConfigFileName,
  resolveAgentWorkspaceConfigPath,
} from "../Source/AgentSystem/Core/AgentWorkspaceLayout.js";

const RuntimeConfigTemplateFileName = "senera.config.example.json";

export interface RuntimeConfigSeedOptions {
  workspaceRoot: string;
  configPath: string;
  templatePath: string;
}

export function seedRuntimeConfigForSource(
  source: AgentConfigSourceOptions,
  resourceRoot: string,
  workspaceRoot: string,
): void {
  if (source.kind !== "json") return;
  try {
    ensureRuntimeConfigFile({
      workspaceRoot,
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
  const secretCodec = new AgentConfigSecretCodec({ workspaceRoot: options.workspaceRoot });
  writeAgentConfigJsonMirror(loadConfigFile(options.templatePath, secretCodec), options.configPath, secretCodec);
}

export function ensureSeneraDevelopmentConfig(workspaceRoot: string): string {
  const configPath = resolveSeneraServerConfigPath(workspaceRoot);
  ensureRuntimeConfigFile({
    workspaceRoot,
    configPath,
    templatePath: path.resolve(workspaceRoot, RuntimeConfigTemplateFileName),
  });
  return configPath;
}

export function resolveSeneraServerConfigPath(workspaceRoot: string): string {
  const configured = process.env.AGENT_CONFIG_PATH?.trim();
  return resolveAgentWorkspaceConfigPath(workspaceRoot, configured || AgentWorkspaceConfigFileName);
}
