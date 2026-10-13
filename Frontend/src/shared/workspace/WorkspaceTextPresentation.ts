import { getFiletypeFromFileName } from "@pierre/diffs";
import type { WorkspaceResourceData } from "../../api/workspaceResourceClient";

export type WorkspaceTextView = "preview" | "source" | "structure";
export interface WorkspaceTextPresentation {
  readonly views: readonly WorkspaceTextView[];
  readonly defaultView: WorkspaceTextView;
}

export function describeWorkspaceText(resource?: WorkspaceResourceData): WorkspaceTextPresentation {
  if (resource?.content === undefined) return { views: [], defaultView: "source" };
  const language = getFiletypeFromFileName(resource.name);
  if (language === "markdown") return { views: ["preview", "source"], defaultView: "preview" };
  if (language === "json") {
    return { views: ["structure", "source"], defaultView: "source" };
  }
  return { views: ["source"], defaultView: "source" };
}
