import { Tooltip } from "../ui/Tooltip";
import { useState } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { AppIcon, IconButton } from "../ui";
import { WorkspaceFileTree } from "./WorkspaceFileTree";

export type WorkspaceExplorerAction = "file" | "directory";
export type WorkspaceResourceExplorerLayout = "sidebar" | "panel";

const layoutClasses: Record<WorkspaceResourceExplorerLayout, string> = {
  sidebar: "w-full shrink-0 border-r border-line sm:w-60 lg:w-64",
  panel: "min-w-0 flex-1",
};

export function WorkspaceResourceExplorer({
  activePath,
  httpBaseUrl,
  layout = "sidebar",
  onCreateEntry,
  onRefresh,
  onSelect,
  revision,
  showHeader = true,
}: {
  readonly activePath: string;
  readonly httpBaseUrl: string;
  /** `panel` fills a dock surface; `sidebar` sits beside the resource viewer. */
  readonly layout?: WorkspaceResourceExplorerLayout;
  /** Omitted when the surrounding surface does not expose entry creation. */
  readonly onCreateEntry?: (action: WorkspaceExplorerAction, parent: string) => void;
  readonly onRefresh: () => void;
  readonly onSelect: (path: string) => void;
  readonly revision: number;
  /** The blank tab hides the redundant section title and refresh row. */
  readonly showHeader?: boolean;
}): JSX.Element {
  const [directory, setDirectory] = useState(".");
  return (
    <aside
      className={cn("flex flex-col bg-surface-panel", layoutClasses[layout])}
      data-workspace-explorer
      data-workspace-explorer-layout={layout}
    >
      {showHeader ? (
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line-subtle px-2.5">
          <Tooltip content={directory}>
            <span className="min-w-0 flex-1 truncate text-xs text-content-secondary">
              {frontendMessage("resource.workspace")}
            </span>
          </Tooltip>
          {onCreateEntry ? (
            <>
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
            </>
          ) : null}
          <IconButton label={frontendMessage("resource.reload")} size="sm" onClick={onRefresh}>
            <AppIcon icon="refresh" size={14} />
          </IconButton>
        </header>
      ) : null}
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
