import { useId, useState } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { AppIcon } from "../../shared/ui";
import { ToolResourceItem } from "./ToolResourcePreview";
import { ToolWorkspaceChangePreview } from "./ToolWorkspaceChangePreview";
import { isWorkspaceFileChange } from "./workspaceChangeActivity";
import {
  summarizeToolWorkspaceChanges,
  type ToolResource,
  type ToolWorkspaceChange,
  type ToolWorkspaceObservation,
} from "./toolResourceProjection";

const InitialResourceListLimit = 3;

/**
 * Presents generated files and workspace mutations as one output surface.
 * Internal patch artifacts are deliberately omitted because a workspace row
 * already points at the real file and can open or download it.
 */
export function ToolArtifactPreview({
  changes = [],
  enableHoverPreview = true,
  label = frontendMessage("workflow.run.output"),
  observation,
  resources = [],
}: {
  readonly changes?: readonly ToolWorkspaceChange[];
  readonly enableHoverPreview?: boolean;
  readonly label?: string;
  readonly observation?: ToolWorkspaceObservation;
  readonly resources?: readonly ToolResource[];
}): JSX.Element | null {
  const visibleResources = resources.filter((resource) => !isInternalWorkspacePatch(resource));
  const workspacePatchResources = resources.filter(isInternalWorkspacePatch);
  const fileChanges = changes.filter(isWorkspaceFileChange);
  const workspaceSummary = summarizeToolWorkspaceChanges(fileChanges);
  const hasEntries = visibleResources.length > 0 || fileChanges.length > 0;
  if (!hasEntries && observation?.status !== "partial") return null;

  return (
    <section className="flex min-w-0 flex-col gap-2.5" data-tool-artifact-preview>
      <header className="workflow-section-header">
        <span className="activity-feed-row__icon workflow-section-header__icon" aria-hidden="true">
          <AppIcon icon="package" size={14} />
        </span>
        <span className="workflow-section-header__title">{label}</span>
        {hasEntries ? (
          <span className="workflow-section-header__meta">{visibleResources.length + fileChanges.length}</span>
        ) : null}
        {workspaceSummary.addedLines > 0 ? (
          <span className="ml-auto text-[10px] tabular-nums text-emerald-700 dark:text-emerald-300">
            {frontendMessage("workflow.run.output.addedLines", { count: workspaceSummary.addedLines })}
          </span>
        ) : null}
        {workspaceSummary.removedLines > 0 ? (
          <span className="text-[10px] tabular-nums text-rose-700 dark:text-rose-300">
            {frontendMessage("workflow.run.output.removedLines", { count: workspaceSummary.removedLines })}
          </span>
        ) : null}
      </header>
      {visibleResources.length > 0 ? (
        <ToolResourceList resources={visibleResources} enableHoverPreview={enableHoverPreview} />
      ) : null}
      {fileChanges.length > 0 || observation ? (
        <ToolWorkspaceChangePreview
          changes={fileChanges}
          enableHoverPreview={enableHoverPreview}
          observation={observation}
          patchResources={workspacePatchResources}
          showHeader={false}
        />
      ) : null}
    </section>
  );
}

function ToolResourceList({
  enableHoverPreview,
  resources,
}: {
  readonly enableHoverPreview: boolean;
  readonly resources: readonly ToolResource[];
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const hiddenCount = resources.length - InitialResourceListLimit;
  const contentId = `tool-resource-more-${useId()}`;

  return (
    <div className="overflow-hidden rounded-lg border border-line-subtle/80 bg-surface-panel" data-tool-resource-list>
      {resources.slice(0, InitialResourceListLimit).map((resource) => (
        <ToolResourceItem
          key={resource.uri}
          resource={resource}
          variant="list"
          enableHoverPreview={enableHoverPreview}
        />
      ))}
      {resources.length > InitialResourceListLimit ? (
        <>
          {expanded ? (
            <div id={contentId} data-tool-resource-more>
              {resources.slice(InitialResourceListLimit).map((resource) => (
                <ToolResourceItem
                  key={resource.uri}
                  resource={resource}
                  variant="list"
                  enableHoverPreview={enableHoverPreview}
                />
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className="flex w-full items-center justify-center gap-1.5 border-t border-line-subtle bg-transparent py-2 text-[11px] font-medium text-content-secondary transition-colors hover:bg-surface-hover hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-focus"
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setExpanded((value) => !value)}
          >
            <AppIcon
              icon="chevron-down"
              size={14}
              className={cn("transition-transform", expanded && "rotate-180")}
              aria-hidden="true"
            />
            {frontendMessage(expanded ? "workflow.workspace.showLess" : "workflow.workspace.showMore", {
              count: hiddenCount,
            })}
          </button>
        </>
      ) : null}
    </div>
  );
}

function isInternalWorkspacePatch(resource: ToolResource): boolean {
  const mime = resource.mime.split(";", 1)[0]?.trim().toLowerCase();
  return (
    resource.origin === "artifact" &&
    (mime === "text/x-diff" || mime === "text/x-patch") &&
    /\.patch$/iu.test(resource.name)
  );
}
