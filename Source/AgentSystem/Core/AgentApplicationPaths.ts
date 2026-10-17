import path from "node:path";
import envPaths from "env-paths";
import {
  AgentWorkspaceProjectPluginsDirectoryName,
  resolveAgentWorkspaceLayout,
  type AgentWorkspaceLayout,
} from "./AgentWorkspaceLayout.js";

/** Application-level catalog state has a stable location independent of the selected project. */
export function resolveAgentApplicationPaths(root = process.env.SENERA_DATA_ROOT): {
  root: string;
  stateRoot: string;
  configPath: string;
  desktopRoot: string;
  workspaceLayout(workspaceRoot: string, workspaceId: string): AgentWorkspaceLayout;
  /** Previous host-owned layout used by releases before workspace-local state. */
  legacyWorkspaceLayout(workspaceRoot: string, workspaceId: string): AgentWorkspaceLayout;
  /** Shared plugin directory used by the release that preceded workspace-local user plugins. */
  legacySharedUserPluginsRoot: string;
} {
  const applicationRoot = path.resolve(root ?? envPaths("Senera", { suffix: "" }).data);
  const layout = resolveAgentWorkspaceLayout(applicationRoot);
  return {
    root: applicationRoot,
    stateRoot: layout.stateRoot,
    configPath: layout.configFile,
    desktopRoot: layout.desktopRuntimeRoot,
    workspaceLayout: (workspaceRoot, _workspaceId) => resolveAgentWorkspaceLayout(workspaceRoot),
    legacyWorkspaceLayout: (workspaceRoot, workspaceId) => {
      const stateRoot = path.join(layout.stateRoot, "workspaces", workspaceId);
      return resolveAgentWorkspaceLayout(
        workspaceRoot,
        stateRoot,
        path.join(stateRoot, AgentWorkspaceProjectPluginsDirectoryName),
      );
    },
    legacySharedUserPluginsRoot: layout.projectPluginsRoot,
  };
}
