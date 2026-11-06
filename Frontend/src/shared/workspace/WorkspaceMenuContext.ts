import { createContext } from "react";
import type { WorkspaceControllerHandle } from "../../app/useWorkspaceController";
import type { AgentWorkspaceId } from "../../../../Source/AgentSystem/WorkspaceResources/AgentWorkspaceCatalogContract";

/**
 * The workspace surface is provided once by `WorkspaceMenuProvider` and read by
 * every entry point (composer chip, desktop bridge). Kept in its own module so
 * those entry points do not import the provider implementation.
 */
export interface WorkspaceMenuHandle {
  workspace: WorkspaceControllerHandle;
  select: (root: string) => void;
  forgetWorkspace: (workspaceId: AgentWorkspaceId) => Promise<void>;
  openFolder: () => Promise<void>;
  openPanel: () => void;
  error?: string;
}

export const WorkspaceMenuContext = createContext<WorkspaceMenuHandle | null>(null);
