import { createContext, useContext } from "react";
import type { WorkspaceControllerHandle } from "../../app/useWorkspaceController";
import type { AgentWorkspaceId } from "../../../../Source/AgentSystem/WorkspaceResources/AgentWorkspaceCatalogContract";

/**
 * The workspace switcher's read/handle surface, kept in its own module so that
 * affordances outside the switcher (the composer's execution context chip) can
 * read the active workspace without pulling the provider and the menu into the
 * bootstrap chunk.
 */
export interface WorkspaceMenuContextValue {
  workspace: WorkspaceControllerHandle;
  select: (root: string) => void;
  forgetWorkspace: (workspaceId: AgentWorkspaceId) => Promise<void>;
  openFolder: () => Promise<void>;
  openPanel: () => void;
  error?: string;
}

export const WorkspaceMenuContext = createContext<WorkspaceMenuContextValue | null>(null);

export function useWorkspaceMenu(): WorkspaceMenuContextValue | null {
  return useContext(WorkspaceMenuContext);
}
