import path from "node:path";
import envPaths from "env-paths";
import { resolveAgentWorkspaceLayout, type AgentWorkspaceLayout } from "./AgentWorkspaceLayout.js";

/** Host state has a stable location independent of the selected project. */
export function resolveAgentApplicationPaths(root = process.env.SENERA_DATA_ROOT): {
  root: string;
  stateRoot: string;
  configPath: string;
  desktopRoot: string;
  workspaceLayout(workspaceRoot: string, workspaceId: string): AgentWorkspaceLayout;
} {
  const applicationRoot = path.resolve(root ?? envPaths("Senera", { suffix: "" }).data);
  const layout = resolveAgentWorkspaceLayout(applicationRoot);
  return {
    root: applicationRoot,
    stateRoot: layout.stateRoot,
    configPath: path.join(applicationRoot, "senera.config.json"),
    desktopRoot: layout.desktopRuntimeRoot,
    workspaceLayout: (workspaceRoot, workspaceId) =>
      resolveAgentWorkspaceLayout(workspaceRoot, path.join(layout.stateRoot, "workspaces", workspaceId)),
  };
}
