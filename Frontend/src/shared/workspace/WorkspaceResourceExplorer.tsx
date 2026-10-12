import { useState } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { AppIcon, IconButton } from "../ui";
import { WorkspaceFileTree } from "./WorkspaceFileTree";

export type WorkspaceExplorerAction = "file" | "directory";
export function WorkspaceResourceExplorer({
  activePath,
  httpBaseUrl,
  onCreateEntry,
  onRefresh,
  onSelect,
  revision,
}: {
  readonly activePath: string;
  readonly httpBaseUrl: string;
  readonly onCreateEntry: (action: WorkspaceExplorerAction, parent: string) => void;
  readonly onRefresh: () => void;
  readonly onSelect: (path: string) => void;
  readonly revision: number;
}): JSX.Element {
  const [directory, setDirectory] = useState(".");
  return (
    <aside
      className="flex w-full shrink-0 flex-col border-r border-line bg-surface-panel sm:w-60 lg:w-64"
      data-workspace-explorer
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line-subtle px-2.5">
        <span className="min-w-0 flex-1 truncate text-xs text-content-secondary" title={directory}>
          {frontendMessage("resource.workspace")}
        </span>
        <IconButton
          label={frontendMessage("resource.createFile")}
          size="sm"
          onClick={() => onCreateEntry("file", directory)}
        >
          <AppIcon icon="plus" size={14} />
        </IconButton>
        <IconButton
          label={frontendMessage("resource.createDirectory")}
          size="sm"
          onClick={() => onCreateEntry("directory", directory)}
        >
          <AppIcon icon="folder" size={14} />
        </IconButton>
        <IconButton label={frontendMessage("resource.reload")} size="sm" onClick={onRefresh}>
          <AppIcon icon="refresh" size={14} />
        </IconButton>
      </header>
      <WorkspaceFileTree
        httpBaseUrl={httpBaseUrl}
        activePath={activePath}
        revision={revision}
        onSelect={onSelect}
        onDirectorySelect={setDirectory}
      />
    </aside>
  );
}
