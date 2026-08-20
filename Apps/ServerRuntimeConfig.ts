import path from "node:path";
import type { AgentConfigSourceOptions } from "../Source/AgentSystem/Config/AgentConfigService.js";

export interface SeneraServerConfigSourceOptions {
  readonly configPath?: string;
  readonly configSource?: AgentConfigSourceOptions;
}

export function resolveServerConfigSource(
  workspaceRoot: string,
  options: SeneraServerConfigSourceOptions,
): AgentConfigSourceOptions {
  if (options.configSource) {
    if (options.configPath) {
      throw new Error("startSeneraServer 不能同时传入 configPath 和 configSource。");
    }
    return normalizeConfigSource(workspaceRoot, options.configSource);
  }

  return {
    kind: "json",
    configPath: options.configPath ? path.resolve(workspaceRoot, options.configPath) : resolveConfigPath(workspaceRoot),
  };
}

export function resolveServerRuntimeConfigPath(workspaceRoot: string, source: AgentConfigSourceOptions): string {
  return source.kind === "json"
    ? source.configPath
    : (source.label ?? resolveWorkspacePath(workspaceRoot, source.databasePath));
}

function resolveConfigPath(workspaceRoot: string): string {
  const configuredPath = process.env.AGENT_CONFIG_PATH?.trim();
  return configuredPath
    ? path.resolve(workspaceRoot, configuredPath)
    : path.resolve(workspaceRoot, "senera.config.json");
}

function normalizeConfigSource(workspaceRoot: string, source: AgentConfigSourceOptions): AgentConfigSourceOptions {
  if (source.kind === "json") {
    return {
      ...source,
      configPath: resolveWorkspacePath(workspaceRoot, source.configPath),
    };
  }

  const databasePath = resolveWorkspacePath(workspaceRoot, source.databasePath);
  return {
    ...source,
    databasePath,
    label: source.label ? resolveWorkspacePath(workspaceRoot, source.label) : databasePath,
  };
}

function resolveWorkspacePath(workspaceRoot: string, value: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(workspaceRoot, value);
}
