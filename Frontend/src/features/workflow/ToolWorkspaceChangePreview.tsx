import { Tooltip } from "../../shared/ui/Tooltip";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { buildWorkspaceResourceUrl } from "../../api/workspaceResourceClient";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { downloadUrl } from "../../lib/download";
import { cn } from "../../lib/util";
import { useWorkspaceResourceController } from "../../shared/workspace/WorkspaceResourceProvider";
import { AppIcon, IconButton, MetaLabel, Popover, PopoverAnchor, PopoverContent, StatusToken } from "../../shared/ui";
import { FilePreviewRowIcon } from "../chat/FilePreviewIcon";
import { DiffPreview } from "./ToolResourcePreview";
import { PierreFilePreview } from "../../shared/code/PierreCodeView";
import { useAppearance } from "../../shared/theme/useAppearance";
import type { ToolResource, ToolWorkspaceChange, ToolWorkspaceObservation } from "./toolResourceProjection";
import { resolveWorkspaceChangePreview, workspaceChangeStatusLabel } from "./workspaceChangeActivity";
import { Button, Spinner } from "../../shared/ui";

import {
  readWorkspacePreview,
  createWorkspacePreviewIdentity,
  workspacePreviewKind,
  type WorkspacePreviewState,
} from "./workspaceChangePreviewLoader";

const WorkspaceChangePreviewLimit = 3;
const WorkspacePreviewDelayMs = 160;
/** The review uses the same verified patch and file resolution as the dock, without a hover interaction. */
export function WorkspaceChangeReviewFile({
  change,
  patchResources,
}: {
  readonly change: ToolWorkspaceChange;
  readonly patchResources: readonly ToolResource[];
}): JSX.Element {
  const controller = useWorkspaceResourceController();
  const { resolvedTheme } = useAppearance();
  const [state, setState] = useState<WorkspacePreviewState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const descriptor = resolveWorkspaceChangePreview(change);
  const previewKind = workspacePreviewKind(descriptor);
  useEffect(() => {
    if (!controller || !previewKind) {
      setState({ status: "unavailable" });
      return;
    }
    let active = true;
    setState({ status: "loading" });
    void readWorkspacePreview({ change, controller, patchResources, previewKind, theme: resolvedTheme }).then(
      (next) => {
        if (active) setState(next);
      },
    );
    return () => {
      active = false;
    };
  }, [change, controller, patchResources, previewKind, resolvedTheme, reloadKey]);
  const source =
    controller && change.workspaceStatus !== "deleted"
      ? buildWorkspaceResourceUrl(controller.httpBaseUrl, change.key, true)
      : undefined;
  return (
    <div className="min-w-0" data-workspace-review-file={change.key}>
      {previewKind ? (
        state.status === "loading" ? (
          <div className="flex items-center gap-2 p-5 text-sm text-content-muted">
            <Spinner />
            {frontendMessage("ui.loading")}
          </div>
        ) : (
          <WorkspaceChangeHoverContent
            change={change}
            state={state}
            showHeader={false}
            onRetry={() => setReloadKey((key) => key + 1)}
          />
        )
      ) : (
        <div className="flex items-center gap-3 p-4">
          <FilePreviewRowIcon name={change.key} />
          <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">{change.key}</span>
          {source ? (
            <Button variant="ghost" size="sm" onClick={() => controller?.openResource({ path: change.key })}>
              {frontendMessage("workflow.workspace.open")}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function ToolWorkspaceChangePreview({
  changes,
  enableHoverPreview = true,
  label,
  observation,
  patchResources = [],
  showHeader = true,
}: {
  readonly changes?: readonly ToolWorkspaceChange[];
  readonly enableHoverPreview?: boolean;
  readonly label?: string;
  readonly observation?: ToolWorkspaceObservation;
  readonly patchResources?: readonly ToolResource[];
  readonly showHeader?: boolean;
}): JSX.Element | null {
  if ((!changes || changes.length === 0) && observation?.status !== "partial") return null;

  const visibleChanges = changes ?? [];
  const previewChanges = visibleChanges.slice(0, WorkspaceChangePreviewLimit);

  return (
    <section className="flex min-w-0 flex-col gap-2.5" data-tool-workspace-change-preview>
      {showHeader ? (
        <div className="flex items-center gap-2 px-0.5">
          <MetaLabel as="h3" size="sm" className="tracking-[0.01em]">
            {label ?? frontendMessage("workflow.node.section.workspaceChanges")}
          </MetaLabel>
          <span className="rounded-full bg-surface-hover px-1.5 py-0.5 text-[9px] tabular-nums text-content-muted">
            {visibleChanges.length}
          </span>
          <WorkspaceLineSummary changes={visibleChanges} />
        </div>
      ) : null}
      {observation?.coverage === "observed" ? (
        <p
          className="flex min-w-0 items-start gap-1.5 text-[10px] leading-4 text-content-muted"
          data-workspace-observation="observed"
        >
          <AppIcon icon="info" size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{frontendMessage("workflow.workspace.observed")}</span>
        </p>
      ) : null}
      {observation?.status === "partial" ? (
        <div
          className={cn(
            "flex min-w-0 items-start gap-2 rounded-md border px-2.5 py-2 text-[11px] text-content-secondary",
            observation.quality === "bounded"
              ? "border-line-subtle bg-surface-subtle/45"
              : "border-danger/30 bg-danger/5",
          )}
          data-workspace-observation={observation.quality === "bounded" ? "bounded" : "partial"}
        >
          <AppIcon
            icon="warning"
            size={14}
            className={cn("mt-0.5 shrink-0", observation.quality === "bounded" ? "text-content-muted" : "text-danger")}
            aria-hidden="true"
          />
          <span className="min-w-0">
            {frontendMessage(
              observation.quality === "bounded" ? "workflow.workspace.bounded" : "workflow.workspace.partial",
              {
                count: observation.warningCount,
              },
            )}
          </span>
        </div>
      ) : null}
      {observation?.warnings && observation.warnings.length > 0 ? (
        <details className="min-w-0 rounded-md border border-line-subtle/70 bg-surface-subtle/30 px-2.5 py-2 text-[11px]">
          <summary className="cursor-pointer select-none text-content-secondary hover:text-content-primary">
            {frontendMessage("workflow.workspace.showDetails")}
          </summary>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-content-muted">
            {observation.warnings.map((warning) => (
              <li key={warning} className="break-words">
                {warning}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-line-subtle/80 bg-surface-panel">
        {previewChanges.map((change) => (
          <WorkspaceChangeRow
            key={`${change.key}:${change.workspaceStatus ?? change.status}`}
            change={change}
            enableHoverPreview={enableHoverPreview}
            patchResources={patchResources}
          />
        ))}
        {visibleChanges.length > previewChanges.length ? (
          <WorkspaceChangeDisclosure
            changes={visibleChanges.slice(previewChanges.length)}
            enableHoverPreview={enableHoverPreview}
            initiallyExpanded={false}
            patchResources={patchResources}
          />
        ) : null}
      </div>
    </section>
  );
}

function WorkspaceLineSummary({ changes }: { readonly changes: readonly ToolWorkspaceChange[] }): JSX.Element | null {
  const added = changes.reduce((total, change) => total + (change.addedLines ?? 0), 0);
  const removed = changes.reduce((total, change) => total + (change.removedLines ?? 0), 0);
  if (added === 0 && removed === 0) return null;
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[10px] tabular-nums">
      {added > 0 ? <span className="text-emerald-700 dark:text-emerald-300">+{added}</span> : null}
      {removed > 0 ? <span className="text-rose-700 dark:text-rose-300">−{removed}</span> : null}
    </span>
  );
}

function WorkspaceChangeDisclosure({
  changes,
  enableHoverPreview,
  initiallyExpanded,
  patchResources,
}: {
  readonly changes: readonly ToolWorkspaceChange[];
  readonly enableHoverPreview: boolean;
  readonly initiallyExpanded: boolean;
  readonly patchResources: readonly ToolResource[];
}): JSX.Element {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const contentId = `workspace-change-more-${changes
    .map((change) => change.key)
    .join("-")
    .replace(/[^A-Za-z0-9_-]/g, "-")}`;
  return (
    <>
      {expanded ? (
        <div id={contentId} data-workspace-change-more>
          {changes.map((change) => (
            <WorkspaceChangeRow
              key={`${change.key}:${change.workspaceStatus ?? change.status}`}
              change={change}
              enableHoverPreview={enableHoverPreview}
              patchResources={patchResources}
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
          count: changes.length,
        })}
      </button>
    </>
  );
}

export function WorkspaceChangeRow({
  change,
  enableHoverPreview = true,
  patchResources = [],
}: {
  readonly change: ToolWorkspaceChange;
  readonly enableHoverPreview?: boolean;
  readonly patchResources?: readonly ToolResource[];
}): JSX.Element {
  const controller = useWorkspaceResourceController();
  const status = change.workspaceStatus ?? "modified";
  const filePreview = resolveWorkspaceChangePreview(change);
  const previewKind = workspacePreviewKind(filePreview);
  const canOpen = status !== "deleted" && Boolean(controller);
  const canPreview =
    enableHoverPreview &&
    previewKind !== undefined &&
    Boolean(
      controller &&
      (previewKind === "image" ? status !== "deleted" : patchResources.length > 0 || status !== "deleted"),
    );
  const { resolvedTheme } = useAppearance();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewState, setPreviewState] = useState<WorkspacePreviewState>({ status: "idle" });
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previewInterestRef = useRef(false);
  const previewRequestRef = useRef<Promise<WorkspacePreviewState> | undefined>(undefined);
  const previewStateRef = useRef<WorkspacePreviewState>({ status: "idle" });
  const previewIdentity = createWorkspacePreviewIdentity({
    change,
    controller,
    patchResources,
    previewKind,
    theme: resolvedTheme,
  });

  useEffect(() => {
    previewRequestRef.current = undefined;
    previewInterestRef.current = false;
    previewStateRef.current = { status: "idle" };
    setPreviewState({ status: "idle" });
    setPreviewOpen(false);
    return () => {
      if (openTimer.current) clearTimeout(openTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [previewIdentity]);

  const updatePreviewState = (next: WorkspacePreviewState): void => {
    previewStateRef.current = next;
    setPreviewState(next);
  };

  const cancelClose = (): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  };
  const scheduleClose = (): void => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      previewInterestRef.current = false;
      setPreviewOpen(false);
      closeTimer.current = undefined;
    }, WorkspacePreviewDelayMs);
  };
  const beginPreview = (): void => {
    if (!controller || !previewKind || !previewIdentity) return;
    const current = previewStateRef.current;
    if (current.status !== "idle" && current.status !== "loading") {
      if (current.status !== "error") {
        if (previewInterestRef.current) setPreviewOpen(true);
        return;
      }
      updatePreviewState({ status: "idle" });
    }
    if (previewRequestRef.current) return;

    updatePreviewState({ status: "loading" });
    const request = readWorkspacePreview({
      change,
      controller,
      patchResources,
      previewKind,
      theme: resolvedTheme,
    });
    previewRequestRef.current = request;
    void request.then((next) => {
      if (previewRequestRef.current !== request) return;
      previewRequestRef.current = undefined;
      updatePreviewState(next);
      if (previewInterestRef.current) setPreviewOpen(true);
    });
  };
  const requestPreview = (immediate = false): void => {
    if (!canPreview) return;
    previewInterestRef.current = true;
    cancelClose();
    if (openTimer.current) clearTimeout(openTimer.current);
    const shouldOpenWhenReady =
      previewStateRef.current.status === "idle" || previewStateRef.current.status === "loading";
    if (immediate) {
      beginPreview();
      if (!shouldOpenWhenReady) setPreviewOpen(true);
      return;
    }
    openTimer.current = setTimeout(() => {
      openTimer.current = undefined;
      beginPreview();
      if (!shouldOpenWhenReady) setPreviewOpen(true);
    }, WorkspacePreviewDelayMs);
  };
  const handleBlur = (): void => scheduleClose();
  const open = (): void => {
    if (canOpen) controller?.openResource({ path: change.key });
  };
  const download = (): void => {
    if (!canOpen || !controller) return;
    void downloadUrl(
      buildWorkspaceResourceUrl(controller.httpBaseUrl, change.key, true),
      change.key.split(/[\\/]/u).pop() ?? "workspace-resource",
    ).catch(() => toast.error(frontendMessage("resource.downloadFailed")));
  };

  return (
    <Popover
      open={previewOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) previewInterestRef.current = false;
        setPreviewOpen(nextOpen);
      }}
    >
      <PopoverAnchor asChild>
        <div
          className="group flex min-w-0 items-center gap-2 px-2.5 py-2.5 transition-colors hover:bg-surface-subtle/65"
          data-workspace-change={change.key}
          onPointerEnter={() => requestPreview()}
          onPointerLeave={scheduleClose}
          onMouseEnter={() => requestPreview()}
          onMouseLeave={scheduleClose}
        >
          <FilePreviewRowIcon
            name={change.key}
            tone={status === "added" ? "added" : status === "deleted" ? "deleted" : "neutral"}
          />
          <Tooltip content={canOpen ? frontendMessage("workflow.workspace.open") : undefined}>
            <button
              type="button"
              className={cn(
                "min-w-0 flex-1 truncate text-left text-[11px] text-content-primary",
                (canOpen || canPreview) && "hover:text-accent-content",
              )}
              disabled={!canOpen && !canPreview}

              data-workspace-change-trigger
              onClick={open}
              onFocus={() => requestPreview(true)}
              onBlur={handleBlur}
            >
              {change.key}
            </button>
          </Tooltip>
          <StatusToken
            size="compact"
            className={cn(
              status === "added" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              status === "deleted" && "bg-rose-500/10 text-rose-700 dark:text-rose-300",
              status !== "added" && status !== "deleted" && "bg-surface-hover text-content-muted",
            )}
            data-workspace-change-status={status}
          >
            {workspaceChangeStatusLabel(status)}
          </StatusToken>
          {change.addedLines || change.removedLines ? (
            <span className="flex shrink-0 items-center gap-1 text-[10px] tabular-nums">
              {change.addedLines ? (
                <span className="text-emerald-700 dark:text-emerald-300">+{change.addedLines}</span>
              ) : null}
              {change.removedLines ? (
                <span className="text-rose-700 dark:text-rose-300">
                  {"\u2212"}
                  {change.removedLines}
                </span>
              ) : null}
            </span>
          ) : null}
          {canOpen ? (
            <IconButton
              label={frontendMessage("workflow.workspace.download")}
              tooltip={frontendMessage("workflow.workspace.download")}
              tooltipSide="bottom"
              size="sm"
              className="h-7 w-7 shrink-0 rounded-md text-content-muted opacity-70 hover:bg-surface-hover hover:text-content-primary group-hover:opacity-100"
              onClick={download}
            >
              <AppIcon icon="download" size={13} />
            </IconButton>
          ) : null}
          {canOpen ? (
            <IconButton
              label={frontendMessage("workflow.workspace.open")}
              tooltip={frontendMessage("workflow.workspace.open")}
              tooltipSide="bottom"
              size="sm"
              className="h-7 w-7 shrink-0 rounded-md text-content-muted opacity-70 hover:bg-surface-hover hover:text-content-primary group-hover:opacity-100"
              onClick={open}
            >
              <AppIcon icon="external-link" size={13} />
            </IconButton>
          ) : null}
        </div>
      </PopoverAnchor>
      {canPreview ? (
        <PopoverContent
          align="start"
          side="top"
          sideOffset={8}
          className="min-w-0 w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
          data-workspace-change-preview
          onPointerEnter={cancelClose}
          onPointerLeave={scheduleClose}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onFocus={cancelClose}
          onBlur={(event) => {
            if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
              scheduleClose();
            }
          }}
        >
          <WorkspaceChangeHoverContent change={change} state={previewState} onRetry={beginPreview} />
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

function WorkspaceChangeHoverContent({
  change,
  state,
  showHeader = true,
  onRetry,
}: {
  readonly change: ToolWorkspaceChange;
  readonly state: WorkspacePreviewState;
  readonly showHeader?: boolean;
  readonly onRetry?: () => void;
}): JSX.Element {
  return (
    <div className="min-w-0" data-workspace-change-preview-content>
      {showHeader ? (
        <header className="flex min-w-0 items-center gap-3 border-b border-line-subtle bg-surface-subtle/45 px-3 py-2.5">
          <Tooltip content={change.key}>
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-content-primary">{change.key}</span>
          </Tooltip>
          <WorkspaceChangeCounts change={change} />
        </header>
      ) : null}
      {state.status === "ready" ? (
        <div
          className={cn("min-w-0", state.kind === "text" && "bg-surface-muted/60 px-2 py-2")}
          data-workspace-preview-kind={state.kind}
        >
          {state.kind === "diff" ? (
            <DiffPreview fileName={change.key} text={state.text} prerenderedHTML={state.prerenderedHTML} />
          ) : null}
          {state.kind === "text" ? (
            <>
              <div className="px-1 pb-1 text-[10px] text-content-muted">
                {frontendMessage("workflow.workspace.preview.currentContent")}
              </div>
              <PierreFilePreview
                code={state.text}
                fileName={change.key}
                bounded
                lineNumbers={false}
                prerenderedHTML={state.prerenderedHTML}
              />
            </>
          ) : null}
          {state.kind === "image" ? <WorkspaceChangeImagePreview source={state.source} alt={change.key} /> : null}
          {state.truncated ? (
            <div className="px-1 pt-1 text-[10px] text-content-muted">
              {frontendMessage("workflow.resource.textTruncated")}
            </div>
          ) : null}
        </div>
      ) : null}
      {state.status === "unavailable" ? (
        <div className="flex min-h-20 items-center gap-2 px-3 py-3 text-[11px] text-content-muted">
          <AppIcon icon="file-text" size={14} aria-hidden="true" />
          <span>{frontendMessage("workflow.workspace.previewUnavailable")}</span>
        </div>
      ) : null}
      {state.status === "error" ? (
        <div className="flex min-h-20 items-center gap-2 px-3 py-3 text-[11px] text-content-muted">
          <AppIcon icon="warning" size={14} aria-hidden="true" />
          <div className="min-w-0 flex-1" role="alert">
            <p>{frontendMessage("workflow.workspace.previewFailed")}</p>
            <p className="mt-1 break-words">{state.message}</p>
          </div>
          {onRetry ? (
            <Button variant="ghost" size="sm" onClick={onRetry}>
              {frontendMessage("ui.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceChangeCounts({ change }: { readonly change: ToolWorkspaceChange }): JSX.Element | null {
  if (!change.addedLines && !change.removedLines) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 text-[10px] tabular-nums">
      {change.addedLines ? <span className="text-emerald-700 dark:text-emerald-300">+{change.addedLines}</span> : null}
      {change.removedLines ? <span className="text-rose-700 dark:text-rose-300">−{change.removedLines}</span> : null}
    </span>
  );
}

function WorkspaceChangeImagePreview({ source, alt }: { readonly source: string; readonly alt: string }): JSX.Element {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex min-h-20 items-center gap-2 px-3 py-3 text-[11px] text-content-muted">
        <AppIcon icon="warning" size={14} aria-hidden="true" />
        <span>{frontendMessage("workflow.workspace.previewUnavailable")}</span>
      </div>
    );
  }
  return (
    <div
      className="flex max-h-[min(60vh,28rem)] min-h-28 items-center justify-center bg-surface-muted/60 p-2"
      data-workspace-image-preview
    >
      <img
        className="max-h-[min(60vh,27rem)] max-w-full object-contain"
        src={source}
        alt={alt}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
