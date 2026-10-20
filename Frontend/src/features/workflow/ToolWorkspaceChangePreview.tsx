import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { buildResourceContentUrl } from "../../api/uploadClient";
import { buildWorkspaceResourceUrl, readWorkspaceResource } from "../../api/workspaceResourceClient";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { downloadUrl } from "../../lib/download";
import { type FilePreviewDescriptor } from "../../lib/filePreview";
import { LruCache } from "../../lib/LruCache";
import { cn } from "../../lib/util";
import { resolveWorkspaceFileIcon } from "../../shared/workspace/workspaceFileIcon";
import { useWorkspaceResourceController } from "../../shared/workspace/WorkspaceResourceProvider";
import { AppIcon, IconButton, MetaLabel, Popover, PopoverAnchor, PopoverContent, StatusToken } from "../../shared/ui";
import { DiffPreview } from "./ToolResourcePreview";
import {
  PierreFilePreview,
  preloadPierreFilePreview,
  preloadPierrePatchPreview,
} from "../../shared/code/PierreCodeView";
import { useAppearance } from "../../shared/theme/useAppearance";
import type { ToolResource, ToolWorkspaceChange, ToolWorkspaceObservation } from "./toolResourceProjection";
import { resolveWorkspaceChangePreview, workspaceChangeStatusLabel } from "./workspaceChangeActivity";

const WorkspaceChangePreviewLimit = 3;
const WorkspacePreviewDelayMs = 160;
const WorkspacePreviewTextLimit = 24_000;
const WorkspacePatchTextCache = new LruCache<string, string>(24);
const WorkspacePreviewCache = new LruCache<string, Promise<WorkspacePreviewState>>(24);

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
          <span
            className={cn(
              "grid h-7 w-7 shrink-0 place-items-center rounded-md",
              status === "added" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              status === "deleted" && "bg-rose-500/10 text-rose-700 dark:text-rose-300",
              status !== "added" && status !== "deleted" && "bg-surface-hover text-content-muted",
            )}
            aria-hidden="true"
          >
            <AppIcon icon={resolveWorkspaceFileIcon(change.key, workspaceIconKind(filePreview))} size={13} />
          </span>
          <button
            type="button"
            className={cn(
              "min-w-0 flex-1 truncate text-left text-[11px] text-content-primary",
              (canOpen || canPreview) && "hover:text-accent-content",
            )}
            disabled={!canOpen && !canPreview}
            title={canOpen ? frontendMessage("workflow.workspace.open") : undefined}
            data-workspace-change-trigger
            onClick={open}
            onFocus={() => requestPreview(true)}
            onBlur={handleBlur}
          >
            {change.key}
          </button>
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
          <WorkspaceChangeHoverContent change={change} state={previewState} />
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

function WorkspaceChangeHoverContent({
  change,
  state,
}: {
  readonly change: ToolWorkspaceChange;
  readonly state: WorkspacePreviewState;
}): JSX.Element {
  return (
    <div className="min-w-0" data-workspace-change-preview-content>
      <header className="flex min-w-0 items-center gap-3 border-b border-line-subtle bg-surface-subtle/45 px-3 py-2.5">
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-content-primary" title={change.key}>
          {change.key}
        </span>
        <WorkspaceChangeCounts change={change} />
      </header>
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
          <span>{frontendMessage("workflow.workspace.previewFailed")}</span>
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

type WorkspacePreviewState =
  | { readonly status: "idle" | "loading" | "unavailable" | "error" }
  | {
      readonly status: "ready";
      readonly kind: "diff" | "text";
      readonly text: string;
      readonly truncated: boolean;
      readonly prerenderedHTML: string;
    }
  | { readonly status: "ready"; readonly kind: "image"; readonly source: string; readonly truncated: false };

type WorkspacePreviewKind = "text" | "image";

async function loadWorkspacePreview(input: {
  readonly change: ToolWorkspaceChange;
  readonly controller: NonNullable<ReturnType<typeof useWorkspaceResourceController>>;
  readonly patchResources: readonly ToolResource[];
  readonly previewKind: WorkspacePreviewKind | undefined;
}): Promise<WorkspacePreviewSource> {
  if (!input.previewKind) return { status: "unavailable" };
  if (input.previewKind === "image") {
    if (input.change.workspaceStatus === "deleted") return { status: "unavailable" };
    return {
      status: "ready",
      kind: "image",
      source: buildWorkspaceResourceUrl(input.controller.httpBaseUrl, input.change.key, true),
      truncated: false,
    };
  }
  const patch = await readPatchPreview(input);
  if (patch) return { status: "ready", kind: "diff", ...boundPreviewText(patch) };
  if (input.change.workspaceStatus === "deleted") return { status: "unavailable" };

  const resource = await readWorkspaceResource(input.controller.httpBaseUrl, input.change.key);
  if (resource.content === undefined) return { status: "unavailable" };
  return { status: "ready", kind: "text", ...boundPreviewText(resource.content) };
}

type WorkspacePreviewSource =
  | { readonly status: "unavailable" }
  | { readonly status: "ready"; readonly kind: "diff" | "text"; readonly text: string; readonly truncated: boolean }
  | { readonly status: "ready"; readonly kind: "image"; readonly source: string; readonly truncated: false };

function readWorkspacePreview(input: {
  readonly change: ToolWorkspaceChange;
  readonly controller: NonNullable<ReturnType<typeof useWorkspaceResourceController>>;
  readonly patchResources: readonly ToolResource[];
  readonly previewKind: WorkspacePreviewKind;
  readonly theme: "light" | "dark";
}): Promise<WorkspacePreviewState> {
  const cacheKey = createWorkspacePreviewIdentity(input);
  const cached = WorkspacePreviewCache.get(cacheKey);
  if (cached) return cached;

  const pending = loadWorkspacePreview(input)
    .then((source) => materializeWorkspacePreview(source, input.change.key, input.theme))
    .catch(() => ({ status: "error" }) satisfies WorkspacePreviewState);
  WorkspacePreviewCache.set(cacheKey, pending);
  void pending.then((state) => {
    if (state.status === "error") WorkspacePreviewCache.delete(cacheKey);
  });
  return pending;
}

async function materializeWorkspacePreview(
  source: WorkspacePreviewSource,
  fileName: string,
  theme: "light" | "dark",
): Promise<WorkspacePreviewState> {
  if (source.status !== "ready") return source;
  if (source.kind === "image") {
    await decodeWorkspacePreviewImage(source.source);
    return source;
  }
  const prerenderedHTML =
    source.kind === "diff"
      ? await preloadPierrePatchPreview({ patch: source.text, theme })
      : await preloadPierreFilePreview({
          code: source.text,
          fileName,
          lineNumbers: false,
          theme,
          wrapped: false,
        });
  return { ...source, prerenderedHTML };
}

function decodeWorkspacePreviewImage(source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      void image.decode().then(resolve, reject);
    };
    image.onerror = reject;
    image.src = source;
  });
}

function createWorkspacePreviewIdentity(input: {
  readonly change: ToolWorkspaceChange;
  readonly controller: ReturnType<typeof useWorkspaceResourceController> | undefined;
  readonly patchResources: readonly ToolResource[];
  readonly previewKind: WorkspacePreviewKind | undefined;
  readonly theme: "light" | "dark";
}): string {
  return JSON.stringify({
    endpoint: input.controller?.httpBaseUrl,
    path: input.change.key,
    status: input.change.workspaceStatus ?? input.change.status,
    previewKind: input.previewKind,
    patchSources: input.patchResources.map((resource) => resource.uri),
    theme: input.theme,
  });
}

function workspacePreviewKind(preview: FilePreviewDescriptor | undefined): WorkspacePreviewKind | undefined {
  if (preview?.renderKind === "image") return "image";
  return preview?.contentKind === "text" ? "text" : undefined;
}

function workspaceIconKind(preview: FilePreviewDescriptor | undefined): "text" | "image" | "binary" {
  if (preview?.renderKind === "image") return "image";
  return preview?.contentKind === "text" ? "text" : "binary";
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

async function readPatchPreview(input: {
  readonly change: ToolWorkspaceChange;
  readonly controller: NonNullable<ReturnType<typeof useWorkspaceResourceController>>;
  readonly patchResources: readonly ToolResource[];
}): Promise<string | undefined> {
  const sources = input.patchResources
    .map((resource) => buildResourceContentUrl(input.controller.httpBaseUrl, resource.uri))
    .filter((source): source is string => Boolean(source));
  const responses = await Promise.all(
    sources.map(async (source) => {
      try {
        const text = await readWorkspacePatchText(source);
        return text ? selectFilePatch(text, input.change.key) : undefined;
      } catch (error) {
        void error;
        return undefined;
      }
    }),
  );
  return [...responses].reverse().find((value): value is string => Boolean(value));
}

async function readWorkspacePatchText(source: string): Promise<string | undefined> {
  const cached = WorkspacePatchTextCache.get(source);
  if (cached !== undefined) return cached;
  const response = await fetch(source, { credentials: "include" });
  if (!response.ok) return undefined;
  const text = await response.text();
  WorkspacePatchTextCache.set(source, text);
  return text;
}

function boundPreviewText(text: string): { readonly text: string; readonly truncated: boolean } {
  const normalized = text.replace(/\r\n?/gu, "\n");
  return normalized.length > WorkspacePreviewTextLimit
    ? { text: `${normalized.slice(0, WorkspacePreviewTextLimit)}\n…`, truncated: true }
    : { text: normalized, truncated: false };
}

function selectFilePatch(patch: string, filePath: string): string | undefined {
  const lines = patch.replace(/\r\n?/gu, "\n").split("\n");
  const headerStarts = lines.flatMap((_, index) => (isPatchHeader(lines, index) ? [index] : []));
  const target = normalizePatchPath(filePath);
  for (const [index, start] of headerStarts.entries()) {
    const nextStart = headerStarts[index + 1] ?? lines.length;
    const block = lines.slice(start, nextStart);
    if (readPatchHeaderPaths(block).some((path) => patchPathMatches(path, target))) return block.join("\n");
  }
  return headerStarts.length === 0 && patch.trim().length > 0 ? patch : undefined;
}

function isPatchHeader(lines: readonly string[], index: number): boolean {
  const line = lines[index] ?? "";
  const next = lines[index + 1] ?? "";
  return line.startsWith("--- ") && next.startsWith("+++ ");
}

function readPatchHeaderPaths(lines: readonly string[]): readonly string[] {
  const hunkStart = lines.findIndex((line) => line.startsWith("@@ "));
  return lines
    .slice(0, hunkStart >= 0 ? hunkStart : 4)
    .flatMap((line) => (line.startsWith("--- ") || line.startsWith("+++ ") ? [normalizePatchPath(line.slice(4))] : []));
}

function patchPathMatches(candidate: string, target: string): boolean {
  return candidate === target || candidate.startsWith(`${target} `) || candidate.startsWith(`${target}\t`);
}

function normalizePatchPath(value: string): string {
  return value
    .trim()
    .replace(/^['"]|['"]$/gu, "")
    .replace(/^(?:a|b)\//u, "")
    .replace(/\\/gu, "/");
}
