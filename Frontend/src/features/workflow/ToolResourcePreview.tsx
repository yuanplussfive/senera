import { Tooltip } from "../../shared/ui/Tooltip";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import "../../styles/markdown.css";
import { buildResourceContentUrl } from "../../api/uploadClient";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { downloadUrl } from "../../lib/download";
import { resolveFilePreview, type FilePreviewRenderKind } from "../../lib/filePreview";
import { cn, formatFileSize } from "../../lib/util";
import { useWorkspaceResourceController } from "../../shared/workspace/WorkspaceResourceProvider";
import { OpenWithDefaultAppButton } from "../../shared/media/OpenWithDefaultAppButton";
import { AppIcon, IconButton, MetaLabel, Spinner } from "../../shared/ui";
import { Popover, PopoverAnchor, PopoverContent } from "../../shared/ui/Popover";
import { FilePreviewRowIcon } from "../chat/FilePreviewIcon";
import { PierreFilePreview, PierrePatchPreview } from "../../shared/code/PierreCodeView";
import type { ToolResource } from "./toolResourceProjection";

type ResourceKind = FilePreviewRenderKind;

const TextPreviewLimitBytes = 128 * 1024;
const TextPreviewLimitCharacters = 16_000;

/**
 * Renders resources from the result contract, independent of the producer.
 * MIME metadata is the only dispatch input; tool names and package IDs never
 * participate in preview selection.
 */
export function ToolResourcePreview({
  label,
  layout = "stack",
  resources,
}: {
  readonly label?: string;
  readonly layout?: "stack" | "grid";
  readonly resources?: readonly ToolResource[];
}): JSX.Element | null {
  if (!resources || resources.length === 0) return null;

  return (
    <section className="flex min-w-0 flex-col gap-2.5" data-tool-resource-preview data-resource-layout={layout}>
      <div className="flex items-center gap-2 px-0.5">
        <MetaLabel as="h3" size="sm" className="tracking-[0.01em]">
          {label ?? frontendMessage("workflow.node.section.resources")}
        </MetaLabel>
        <span className="rounded-full bg-surface-hover px-1.5 py-0.5 text-[9px] tabular-nums text-content-muted">
          {resources.length}
        </span>
      </div>
      <div className={layout === "grid" ? "grid min-w-0 gap-2.5 sm:grid-cols-2" : "flex min-w-0 flex-col gap-2.5"}>
        {resources.map((resource) => (
          <ToolResourceItem key={resource.uri} resource={resource} />
        ))}
      </div>
    </section>
  );
}

export function ToolResourceItem({
  resource,
  variant = "card",
  enableHoverPreview = true,
}: {
  readonly resource: ToolResource;
  readonly variant?: "card" | "list";
  readonly enableHoverPreview?: boolean;
}): JSX.Element {
  const controller = useWorkspaceResourceController();
  const source = controller ? buildResourceContentUrl(controller.httpBaseUrl, resource.uri) : undefined;
  const kind = resolveResourceKind(resource);
  const previewKind = resolveHoverPreviewKind(kind);
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const canPreview = enableHoverPreview && Boolean(source && previewKind);

  const stopPreviewClose = (): void => {
    if (previewCloseTimer.current === undefined) return;
    clearTimeout(previewCloseTimer.current);
    previewCloseTimer.current = undefined;
  };

  const openPreview = (): void => {
    if (!canPreview) return;
    stopPreviewClose();
    setPreviewOpen(true);
  };

  const schedulePreviewClose = (): void => {
    stopPreviewClose();
    previewCloseTimer.current = setTimeout(() => {
      setPreviewOpen(false);
      previewCloseTimer.current = undefined;
    }, 160);
  };

  useEffect(
    () => () => {
      if (previewCloseTimer.current !== undefined) clearTimeout(previewCloseTimer.current);
    },
    [],
  );

  const download = (): void => {
    if (!source) return;
    void downloadUrl(source, resource.name).catch(() => {
      toast.error(frontendMessage("resource.downloadFailed"));
    });
  };

  return (
    <Popover
      open={previewOpen}
      onOpenChange={(open) => {
        stopPreviewClose();
        setPreviewOpen(open);
      }}
    >
      <PopoverAnchor asChild>
        <article
          className={cn(
            "min-w-0 transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
            variant === "list"
              ? "rounded-none bg-transparent px-4 py-2"
              : "rounded-md border border-line-subtle/80 bg-surface-panel px-2.5 py-1.5",
          )}
          data-tool-resource={resource.uri}
          data-resource-kind={kind}
          role={canPreview ? "group" : undefined}
          aria-label={canPreview ? resource.name : undefined}
          tabIndex={canPreview ? 0 : undefined}
          onPointerEnter={canPreview ? openPreview : undefined}
          onPointerLeave={canPreview ? schedulePreviewClose : undefined}
          onFocusCapture={canPreview ? openPreview : undefined}
          onBlurCapture={
            canPreview
              ? (event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) schedulePreviewClose();
                }
              : undefined
          }
        >
          <header className="flex min-w-0 items-center gap-2">
            <Tooltip content={resource.name}>
              <button
                type="button"
                className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus disabled:cursor-default"
                disabled={!source}
                aria-label={frontendMessage("chat.attachment.filePreview", { name: resource.name })}
                onClick={() => {
                  setPreviewOpen(false);
                  if (source) controller?.openPreview({ ...resource, source });
                }}
              >
                <FilePreviewRowIcon name={resource.name} mime={resource.mime} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[11.5px] font-medium text-content-primary">{resource.name}</span>
                  <span className="flex min-w-0 items-center gap-1.5 truncate text-[9.5px] text-content-muted">
                    <span className="truncate">
                      {resolveFilePreview({ name: resource.name, mime: resource.mime }).label}
                    </span>
                    {resource.size !== undefined ? (
                      <span className="shrink-0">{formatFileSize(resource.size)}</span>
                    ) : null}
                  </span>
                </span>
              </button>
            </Tooltip>
            {source ? (
              <IconButton
                label={frontendMessage("workflow.resource.download")}
                tooltip={frontendMessage("workflow.resource.download")}
                tooltipSide="bottom"
                size="sm"
                className="h-7 w-7 shrink-0 rounded-md text-content-muted hover:bg-surface-hover hover:text-content-primary"
                onClick={download}
              >
                <AppIcon icon="download" size={14} />
              </IconButton>
            ) : null}
            {kind === "file" ? (
              <OpenWithDefaultAppButton
                name={resource.name}
                source={source}
                size="sm"
                className="h-7 w-7 shrink-0 rounded-md text-content-muted hover:bg-surface-hover hover:text-content-primary"
              />
            ) : null}
          </header>
        </article>
      </PopoverAnchor>
      {source && previewKind ? (
        <PopoverContent
          side="bottom"
          align="center"
          className="w-[min(36rem,calc(100vw-2rem))] p-2"
          onPointerEnter={stopPreviewClose}
          onPointerLeave={schedulePreviewClose}
          onFocusCapture={stopPreviewClose}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) schedulePreviewClose();
          }}
          data-resource-hover-preview
        >
          <ResourceHoverPreview kind={previewKind} resource={resource} source={source} />
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

function ResourceHoverPreview({
  kind,
  resource,
  source,
}: {
  readonly kind: HoverPreviewKind;
  readonly resource: ToolResource;
  readonly source: string;
}): JSX.Element {
  return (
    <div className="min-w-0" data-resource-preview-kind={kind}>
      {kind === "pdf" ? (
        <iframe
          className="h-[min(70vh,32rem)] w-full border-0 bg-white"
          src={source}
          title={frontendMessage("workflow.resource.pdfPreview")}
          loading="lazy"
        />
      ) : null}
      {kind === "diff" || kind === "text" ? (
        <TextResourceBody resource={resource} source={source} diff={kind === "diff"} />
      ) : null}
    </div>
  );
}

function TextResourceBody({
  diff = false,
  resource,
  source,
}: {
  readonly diff?: boolean;
  readonly resource: ToolResource;
  readonly source?: string;
}): JSX.Element {
  const [state, setState] = useState<TextPreviewState>({ status: "idle" });

  useEffect(() => {
    if (!source) {
      setState({ status: "unavailable" });
      return;
    }
    if (resource.size !== undefined && resource.size > TextPreviewLimitBytes) {
      setState({ status: "too-large" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    void fetch(source, { credentials: "include", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Resource preview failed with status ${response.status}.`);
        const text = await response.text();
        if (controller.signal.aborted) return;
        const truncated = text.length > TextPreviewLimitCharacters;
        setState({
          status: "ready",
          text: truncated ? `${text.slice(0, TextPreviewLimitCharacters)}\n…` : text,
          truncated,
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setState({ status: "error" });
      });
    return () => controller.abort();
  }, [resource.size, source]);

  if (state.status === "loading" || state.status === "idle") {
    return (
      <div className="flex h-20 items-center justify-center text-content-muted" aria-busy="true">
        <Spinner size="sm" />
      </div>
    );
  }
  if (state.status === "ready") {
    return (
      <div className="min-w-0 bg-surface-muted/70 px-1.5 py-1.5" data-resource-preview-content={diff ? "diff" : "text"}>
        {diff ? <DiffPreview text={state.text} /> : null}
        {!diff ? <PierreFilePreview code={state.text} fileName={resource.name} bounded lineNumbers={false} /> : null}
        {state.truncated ? (
          <div className="px-1 pt-1 text-[10px] text-content-muted">
            {frontendMessage("workflow.resource.textTruncated")}
          </div>
        ) : null}
      </div>
    );
  }
  return <UnavailableResourceBody message={state.status === "too-large" ? "too-large" : undefined} />;
}

export function DiffPreview({
  fileName,
  prerenderedHTML,
  text,
}: {
  readonly fileName?: string;
  readonly prerenderedHTML?: string;
  readonly text: string;
}): JSX.Element {
  return <PierrePatchPreview patch={text} fileName={fileName} prerenderedHTML={prerenderedHTML} />;
}

function UnavailableResourceBody({ message }: { readonly message?: "too-large" }): JSX.Element {
  return (
    <div className="flex min-h-16 items-center gap-2 px-2.5 py-3 text-[11px] text-content-muted">
      <AppIcon icon="warning" size={16} aria-hidden="true" />
      <span>
        {message === "too-large"
          ? frontendMessage("workflow.resource.textTooLarge")
          : frontendMessage("workflow.resource.previewUnavailable")}
      </span>
    </div>
  );
}

type TextPreviewState =
  | { readonly status: "idle" | "loading" | "unavailable" | "error" | "too-large" }
  | { readonly status: "ready"; readonly text: string; readonly truncated: boolean };

type HoverPreviewKind = Extract<ResourceKind, "pdf" | "diff" | "text">;

function resolveHoverPreviewKind(kind: ResourceKind): HoverPreviewKind | undefined {
  if (kind === "pdf" || kind === "diff" || kind === "text") return kind;
  return undefined;
}

function resolveResourceKind(resource: ToolResource): ResourceKind {
  return resolveFilePreview({ name: resource.name, mime: resource.mime }).renderKind;
}
