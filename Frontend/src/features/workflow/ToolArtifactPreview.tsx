import { Tooltip } from "../../shared/ui/Tooltip";
import { useId, useState } from "react";
import { toast } from "sonner";
import { undoWorkspaceCheckpoint } from "../../api/workspaceResourceClient";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { useWorkspaceResourceController } from "../../shared/workspace/WorkspaceResourceProvider";
import { AppIcon, Button, Dialog, DialogActionButton, DialogActions, DialogContent, ScrollArea } from "../../shared/ui";
import { ToolResourceItem } from "./ToolResourcePreview";
import { ToolWorkspaceChangePreview, WorkspaceChangeReviewFile } from "./ToolWorkspaceChangePreview";
import { FilePreviewRowIcon } from "../chat/FilePreviewIcon";
import {
  summarizeToolWorkspaceChanges,
  type ReversibleWorkspaceCheckpoint,
  type ToolResource,
  type ToolWorkspaceChange,
  type ToolWorkspaceObservation,
} from "./toolResourceProjection";
import { isWorkspaceFileChange } from "./workspaceChangeActivity";

const InitialResourceListLimit = 3;
const InitialChangeListLimit = 3;

/**
 * One result contract supports two intentional densities. Conversation output
 * stays a stable run summary, while the workflow dock remains the inspection
 * surface where per-file hover previews are useful.
 */
export function ToolArtifactPreview({
  changes = [],
  checkpoints,
  enableHoverPreview = true,
  label = frontendMessage("workflow.run.output"),
  mode = "detail",
  observation,
  resources = [],
}: {
  readonly changes?: readonly ToolWorkspaceChange[];
  readonly checkpoints?: readonly ReversibleWorkspaceCheckpoint[];
  readonly enableHoverPreview?: boolean;
  readonly label?: string;
  readonly mode?: "summary" | "detail";
  readonly observation?: ToolWorkspaceObservation;
  readonly resources?: readonly ToolResource[];
}): JSX.Element | null {
  const visibleResources = resources.filter((resource) => !isInternalWorkspacePatch(resource));
  const workspacePatchResources = resources.filter(isInternalWorkspacePatch);
  const fileChanges = changes.filter(isWorkspaceFileChange);
  const workspaceSummary = summarizeToolWorkspaceChanges(fileChanges);
  const hasEntries = visibleResources.length > 0 || fileChanges.length > 0;
  if (!hasEntries && observation?.status !== "partial") return null;

  if (mode === "summary") {
    return (
      <TurnOutputSummary
        changes={fileChanges}
        checkpoints={checkpoints}
        observation={observation}
        patchResources={workspacePatchResources}
        resources={visibleResources}
        summary={workspaceSummary}
      />
    );
  }

  return (
    <section className="flex min-w-0 flex-col gap-2.5" data-tool-artifact-preview data-output-mode="detail">
      <header className="workflow-section-header">
        <span className="activity-feed-row__icon workflow-section-header__icon" aria-hidden="true">
          <AppIcon icon="package" size={14} />
        </span>
        <span className="workflow-section-header__title">{label}</span>
        {hasEntries ? (
          <span className="workflow-section-header__meta">{visibleResources.length + fileChanges.length}</span>
        ) : null}
        <LineDelta
          addedLines={workspaceSummary.addedLines}
          removedLines={workspaceSummary.removedLines}
          className="ml-auto"
        />
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

function TurnOutputSummary({
  changes,
  checkpoints,
  observation,
  patchResources,
  resources,
  summary,
}: {
  readonly changes: readonly ToolWorkspaceChange[];
  readonly checkpoints?: readonly ReversibleWorkspaceCheckpoint[];
  readonly observation?: ToolWorkspaceObservation;
  readonly patchResources: readonly ToolResource[];
  readonly resources: readonly ToolResource[];
  readonly summary: ReturnType<typeof summarizeToolWorkspaceChanges>;
}): JSX.Element {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewPath, setReviewPath] = useState<string>();
  const controller = useWorkspaceResourceController();
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  const canUndo = Boolean(checkpoints?.length && controller && !undone);

  const undo = async (): Promise<void> => {
    if (!checkpoints?.length || !controller) return;
    setUndoing(true);
    try {
      const result = await undoWorkspaceCheckpoint(controller.httpBaseUrl, { checkpoints }, controller.csrfToken);
      toast.success(frontendMessage("workflow.run.output.undoCompleted", { count: result.restoredPaths.length }));
      setUndone(true);
      setConfirmUndo(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : frontendMessage("workflow.run.output.undoFailed"));
    } finally {
      setUndoing(false);
    }
  };

  return (
    <div className="mt-0.5 min-w-0 space-y-3" data-tool-artifact-preview data-output-mode="summary">
      {changes.length > 0 ? (
        <section
          className="overflow-hidden rounded-lg border border-line-subtle bg-surface-panel"
          data-turn-file-changes
        >
          <header className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-subtle px-4 py-3">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-surface-subtle text-content-secondary"
              aria-hidden="true"
            >
              <AppIcon icon="file-code" size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-content-primary">
                {frontendMessage("workflow.run.output.changedFiles", { count: summary.fileCount })}
              </p>
              <LineDelta addedLines={summary.addedLines} removedLines={summary.removedLines} className="mt-0.5" />
            </div>
            {undone ? (
              <span className="shrink-0 text-[11px] text-content-muted">
                {frontendMessage("workflow.run.output.undone")}
              </span>
            ) : null}
            {!undone ? (
              <Tooltip
                content={
                  canUndo
                    ? frontendMessage("workflow.run.output.undoDescription")
                    : frontendMessage("workflow.run.output.undoUnavailable")
                }
              >
                <span className="inline-flex shrink-0">
                  <Button variant="ghost" size="sm" disabled={!canUndo || undoing} onClick={() => setConfirmUndo(true)}>
                    {frontendMessage("workflow.run.output.undo")}
                    <AppIcon icon="undo" size={14} />
                  </Button>
                </span>
              </Tooltip>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 rounded-lg !shadow-none"
              onClick={() => {
                setReviewPath(undefined);
                setReviewOpen(true);
              }}
            >
              {frontendMessage("workflow.run.output.review")}
            </Button>
          </header>
          <SummaryChangeList
            changes={changes}
            onReview={(path) => {
              setReviewPath(path);
              setReviewOpen(true);
            }}
          />
        </section>
      ) : null}
      {resources.length > 0 ? (
        <section className="min-w-0" data-turn-output-resources>
          <p className="mb-2 px-0.5 text-xs text-content-muted">
            {frontendMessage("workflow.run.output.generatedResources", { count: resources.length })}
          </p>
          <ToolResourceList resources={resources} enableHoverPreview={false} />
        </section>
      ) : null}
      <WorkspaceChangeReviewDialog
        changes={changes}
        observation={observation}
        open={reviewOpen}
        patchResources={patchResources}
        resources={resources}
        selectedPath={reviewPath}
        onOpenChange={setReviewOpen}
      />
      <Dialog open={confirmUndo} onOpenChange={(open) => !undoing && setConfirmUndo(open)}>
        <DialogContent
          title={frontendMessage("workflow.run.output.undoTitle")}
          description={frontendMessage("workflow.run.output.undoDescription")}
          className="w-[min(28rem,calc(100vw-2rem))]"
          footer={
            <DialogActions>
              <DialogActionButton close disabled={undoing}>
                {frontendMessage("ui.cancel")}
              </DialogActionButton>
              <DialogActionButton variant="danger" loading={undoing} onClick={() => void undo()}>
                {frontendMessage("workflow.run.output.undo")}
              </DialogActionButton>
            </DialogActions>
          }
        >
          <p className="text-[12px] leading-5 text-content-secondary">
            {frontendMessage("workflow.run.output.undoGuard")}
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryChangeList({
  changes,
  onReview,
}: {
  readonly changes: readonly ToolWorkspaceChange[];
  readonly onReview: (path: string) => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? changes : changes.slice(0, InitialChangeListLimit);
  const hiddenCount = changes.length - visible.length;
  const contentId = `turn-output-files-${useId()}`;

  return (
    <div data-turn-output-change-list>
      <div id={contentId}>
        {visible.map((change) => (
          <SummaryChangeRow
            key={`${change.key}:${change.workspaceStatus ?? change.status}`}
            change={change}
            onReview={onReview}
          />
        ))}
      </div>
      {hiddenCount > 0 ? (
        <button
          type="button"
          className="flex w-full items-center gap-1.5 border-t border-line-subtle/80 px-3.5 py-2.5 text-left text-[12px] text-content-secondary transition-colors hover:bg-surface-hover hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-focus"
          aria-controls={contentId}
          aria-expanded={false}
          onClick={() => setExpanded(true)}
        >
          <span>{frontendMessage("workflow.workspace.showMore", { count: hiddenCount })}</span>
          <AppIcon icon="chevron-down" size={14} aria-hidden="true" />
        </button>
      ) : null}
      {expanded && changes.length > InitialChangeListLimit ? (
        <button
          type="button"
          className="flex w-full items-center gap-1.5 border-t border-line-subtle/80 px-3.5 py-2.5 text-left text-[12px] text-content-secondary transition-colors hover:bg-surface-hover hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-focus"
          aria-controls={contentId}
          aria-expanded
          onClick={() => setExpanded(false)}
        >
          <span>{frontendMessage("workflow.workspace.showLess")}</span>
          <AppIcon icon="chevron-up" size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function SummaryChangeRow({
  change,
  onReview,
}: {
  readonly change: ToolWorkspaceChange;
  readonly onReview: (path: string) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onReview(change.key)}
      className="flex w-full min-w-0 items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-focus"
      data-turn-output-change={change.key}
    >
      <Tooltip content={change.key}>
        <span className="min-w-0 flex-1 truncate text-[13px] text-content-secondary">{change.key}</span>
      </Tooltip>
      <LineDelta addedLines={change.addedLines ?? 0} removedLines={change.removedLines ?? 0} />
    </button>
  );
}

function WorkspaceChangeReviewDialog({
  changes,
  observation,
  open,
  patchResources,
  resources,
  selectedPath,
  onOpenChange,
}: {
  readonly changes: readonly ToolWorkspaceChange[];
  readonly observation?: ToolWorkspaceObservation;
  readonly open: boolean;
  readonly patchResources: readonly ToolResource[];
  readonly resources: readonly ToolResource[];
  readonly selectedPath?: string;
  readonly onOpenChange: (open: boolean) => void;
}): JSX.Element {
  return (
    <Dialog
      // Pierre renders its code viewport in a Shadow DOM. Dialog's default
      // scroll lock retargets wheel events before that viewport can receive them.
      modal={false}
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent
        title={frontendMessage("workflow.run.output.allChanges")}
        description={frontendMessage("workflow.run.output.allChangesDescription")}
        className="flex h-[min(42rem,calc(100dvh-2rem))] w-[min(52rem,calc(100vw-2rem))] flex-col"
        bodyClassName="min-h-0 flex-1 p-0"
      >
        <ScrollArea className="h-full min-h-0" viewportClassName="p-4" data-workspace-change-review-scroll>
          <div className="flex min-w-0 flex-col gap-5">
            {changes.length > 0 || observation ? (
              <div className="min-w-0 space-y-2">
                {changes.map((change, index) => (
                  <ReviewFileDisclosure
                    key={change.key}
                    change={change}
                    patchResources={patchResources}
                    initiallyOpen={change.key === selectedPath || (!selectedPath && index === 0)}
                  />
                ))}
                {observation?.status === "partial" ? (
                  <ToolWorkspaceChangePreview changes={[]} observation={observation} />
                ) : null}
              </div>
            ) : null}
            {resources.length > 0 ? <ToolResourceList resources={resources} enableHoverPreview /> : null}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

/** Mount expensive previews only after their native disclosure has actually opened. */
function ReviewFileDisclosure({
  change,
  patchResources,
  initiallyOpen,
}: Parameters<typeof WorkspaceChangeReviewFile>[0] & { initiallyOpen: boolean }): JSX.Element {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="group overflow-hidden rounded-md border border-line-subtle"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 bg-surface-subtle/40 px-3 py-2.5 text-sm text-content-primary [&::-webkit-details-marker]:hidden">
        <AppIcon icon="chevron-right" size={14} className="transition-transform group-open:rotate-90" />
        <FilePreviewRowIcon name={change.key} />
        <span className="min-w-0 flex-1 truncate">{change.key}</span>
        <LineDelta addedLines={change.addedLines ?? 0} removedLines={change.removedLines ?? 0} />
      </summary>
      {open ? <WorkspaceChangeReviewFile change={change} patchResources={patchResources} /> : null}
    </details>
  );
}

function LineDelta({
  addedLines,
  removedLines,
  className,
}: {
  readonly addedLines: number;
  readonly removedLines: number;
  readonly className?: string;
}): JSX.Element | null {
  if (addedLines === 0 && removedLines === 0) return null;
  return (
    <span
      className={cn("flex shrink-0 items-center gap-2 text-[11px] tabular-nums", className)}
      data-workspace-line-delta
    >
      {addedLines > 0 ? <span className="text-emerald-700 dark:text-emerald-300">+{addedLines}</span> : null}
      {removedLines > 0 ? <span className="text-rose-700 dark:text-rose-300">−{removedLines}</span> : null}
    </span>
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
            className="flex w-full items-center gap-1.5 border-t border-line-subtle bg-transparent px-4 py-2 text-left text-[12px] text-content-secondary transition-colors hover:bg-surface-hover hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-focus"
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
