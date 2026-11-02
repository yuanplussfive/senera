import path from "node:path";
import type { AgentConfigSourceOptions } from "../Source/AgentSystem/Config/AgentConfigService.js";
import {
  resolveAgentWorkspaceConfigPath,
  resolveAgentWorkspaceLayout,
} from "../Source/AgentSystem/Core/AgentWorkspaceLayout.js";

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
    configPath: options.configPath
      ? resolveAgentWorkspaceConfigPath(workspaceRoot, options.configPath)
      : resolveConfigPath(workspaceRoot),
  };
}

export function resolveServerRuntimeConfigPath(workspaceRoot: string, source: AgentConfigSourceOptions): string {
  return source.kind === "json"
    ? source.configPath
    : (source.label ?? resolveWorkspacePath(workspaceRoot, source.databasePath));
}

/** Derives a workspace-local config source from the host's source contract. */
export function resolveWorkspaceServerConfigSource(
  workspaceRoot: string,
  template: AgentConfigSourceOptions,
  sourceWorkspaceRoot?: string,
): AgentConfigSourceOptions {
  if (template.kind === "json") {
    const targetRoot = path.resolve(workspaceRoot);
    const sourceRoot = path.resolve(sourceWorkspaceRoot ?? path.dirname(template.configPath));
    const relative = path.relative(sourceRoot, path.resolve(template.configPath));
    const isPortableRelativePath = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    return {
      kind: "json",
      configPath: isPortableRelativePath
        ? path.resolve(targetRoot, relative)
        : resolveAgentWorkspaceConfigPath(targetRoot),
    };
  }
  const layout = resolveAgentWorkspaceLayout(workspaceRoot);
  return {
    kind: "sqlite",
    databasePath: layout.databases.config,
    seedConfig: template.seedConfig,
    label: layout.databases.config,
  };
}

function resolveConfigPath(workspaceRoot: string): string {
  const configuredPath = process.env.AGENT_CONFIG_PATH?.trim();
  return configuredPath
    ? resolveAgentWorkspaceConfigPath(workspaceRoot, configuredPath)
    : resolveAgentWorkspaceConfigPath(workspaceRoot);
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
