import path from "node:path";
import type { ResolvedAgentSandboxRuntimeConfig } from "../Types/AgentConfigTypes.js";

export interface AgentSandboxRuntimePaths {
  baseDir: string;
}

export interface AgentSandboxRuntimePreparationResult {
  paths: AgentSandboxRuntimePaths;
  preparedImages: string[];
}

export function resolveAgentSandboxRuntimePaths(
  workspaceRoot: string,
  config: Pick<ResolvedAgentSandboxRuntimeConfig, "BaseDir">,
): AgentSandboxRuntimePaths {
  return {
    baseDir: path.isAbsolute(config.BaseDir)
      ? path.normalize(config.BaseDir)
      : path.resolve(workspaceRoot, config.BaseDir),
  };
}
