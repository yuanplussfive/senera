import path from "node:path";
import envPaths from "env-paths";
import {
  AgentWorkspaceProjectPluginsDirectoryName,
  resolveAgentWorkspaceLayout,
  type AgentWorkspaceLayout,
} from "./AgentWorkspaceLayout.js";

export interface AgentApplicationPaths {
  readonly root: string;
  readonly stateRoot: string;
  readonly configPath: string;
  readonly desktopRoot: string;
  /** Senera-managed persistent browser profiles, shared by workspaces on this host. */
  readonly browserProfilesRoot: string;
  /** Master keys for every secret domain; shared by all workspaces on this host. */
  readonly secretKeysRoot: string;
  /** Root of the host-owned per-workspace state used by releases before workspace-local state. */
  readonly legacyWorkspacesRoot: string;
  workspaceLayout(workspaceRoot: string, workspaceId: string): AgentWorkspaceLayout;
  /** Previous host-owned layout used by releases before workspace-local state. */
  legacyWorkspaceLayout(workspaceRoot: string, workspaceId: string): AgentWorkspaceLayout;
  /** Shared plugin directory used by the release that preceded workspace-local user plugins. */
  readonly legacySharedUserPluginsRoot: string;
}

/** Application-level catalog state has a stable location independent of the selected project. */
export function resolveAgentApplicationPaths(root = process.env.SENERA_DATA_ROOT): AgentApplicationPaths {
  const applicationRoot = path.resolve(root ?? envPaths("Senera", { suffix: "" }).data);
  const layout = resolveAgentWorkspaceLayout(applicationRoot);
  const legacyWorkspacesRoot = path.join(layout.stateRoot, "workspaces");
  return {
    root: applicationRoot,
    stateRoot: layout.stateRoot,
    configPath: layout.configFile,
    desktopRoot: layout.desktopRuntimeRoot,
    browserProfilesRoot: path.join(layout.stateRoot, "browser", "profiles"),
    secretKeysRoot: path.join(layout.stateRoot, "keys"),
    legacyWorkspacesRoot,
    workspaceLayout: (workspaceRoot, _workspaceId) => resolveAgentWorkspaceLayout(workspaceRoot),
    legacyWorkspaceLayout: (workspaceRoot, workspaceId) => {
      const stateRoot = path.join(legacyWorkspacesRoot, workspaceId);
      return resolveAgentWorkspaceLayout(
        workspaceRoot,
        stateRoot,
        path.join(stateRoot, AgentWorkspaceProjectPluginsDirectoryName),
      );
    },
    legacySharedUserPluginsRoot: layout.projectPluginsRoot,
  };
}
