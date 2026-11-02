import { createFileTreeIconResolver, type FileTreeIconConfig } from "@pierre/trees";

/** Shared filename and extension rules for the tree and its open documents. */
export const WorkspaceFileTreeIcons = { set: "complete", colored: true } as const satisfies FileTreeIconConfig;

const icons = createFileTreeIconResolver(WorkspaceFileTreeIcons);

export function resolveWorkspaceFileIcon(path: string) {
  return icons.resolveIcon("file-tree-icon-file", path.replace(/\\/gu, "/"));
}
