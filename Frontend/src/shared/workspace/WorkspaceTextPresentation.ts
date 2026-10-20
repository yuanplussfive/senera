import { getFiletypeFromFileName } from "@pierre/diffs";
import type { WorkspaceResourceData } from "../../api/workspaceResourceClient";
import { resolveCodePreviewForFile, type CodePreview } from "../code/CodePreviewRegistry";

export type WorkspaceTextView = "preview" | "source" | "structure";
export interface WorkspaceTextPresentation {
  readonly views: readonly WorkspaceTextView[];
  readonly defaultView: WorkspaceTextView;
  readonly codePreview?: CodePreview;
}

export function describeWorkspaceText(resource?: WorkspaceResourceData): WorkspaceTextPresentation {
  if (resource?.content === undefined) return { views: [], defaultView: "source" };
  const language = getFiletypeFromFileName(resource.name);
  const codePreview = resolveCodePreviewForFile(resource.name, resource.content, language);
  if (codePreview) return { views: ["preview", "source"], defaultView: "preview", codePreview };
  if (language === "markdown") return { views: ["preview", "source"], defaultView: "preview" };
  if (language === "json") {
    return { views: ["structure", "source"], defaultView: "source" };
  }
  return { views: ["source"], defaultView: "source" };
}
