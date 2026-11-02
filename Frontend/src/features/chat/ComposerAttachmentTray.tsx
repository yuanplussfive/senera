import type { UploadProgress } from "../../api/uploadClient";
import { formatUploadProgress, readProgressRatio } from "../../api/uploadProgress";
import { cn, formatFileSize } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { isImageFilePreview } from "../../lib/filePreview";
import { MotionList, MotionListItem } from "../../shared/motion";
import { AppIcon, IconButton, Spinner, Tooltip } from "../../shared/ui";
import { useWorkspaceResourceController } from "../../shared/workspace/WorkspaceResourceProvider";
import { buildResourceContentUrl } from "../../api/uploadClient";
import { FilePreviewIcon } from "./FilePreviewIcon";
import type { PendingAttachment } from "./useComposerAttachments";

export function ComposerAttachmentTray({
  attachments,
  onRemove,
  onRetry,
  onPreviewUnavailable,
}: {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onPreviewUnavailable: (id: string) => void;
}): JSX.Element {
  const workspace = useWorkspaceResourceController();
  const previewable = (entry: PendingAttachment): boolean => Boolean(entry.file || entry.previewUrl);
  const activatePreview = (entry: PendingAttachment): void => {
    if (!previewable(entry)) return;
    const source =
      entry.attachment && workspace
        ? buildResourceContentUrl(workspace.httpBaseUrl, entry.attachment.resourceUri)
        : entry.previewUrl;
    workspace?.openPreview({
      file: entry.file,
      mime: entry.mime ?? entry.attachment?.mime,
      name: entry.fileName,
      size: entry.size,
      source,
    });
  };

  return (
    <>
      <MotionList className={cn("flex flex-wrap gap-1.5 px-0.5 pb-1", attachments.length === 0 && "hidden")}>
        {attachments.map((entry) => (
          <MotionListItem
            key={entry.id}
            layout="position"
            initial={false}
            className={cn(
              entry.previewUrl && isImageFilePreview({ name: entry.fileName, mime: entry.mime }) && "shrink-0",
            )}
          >
            {entry.previewUrl && isImageFilePreview({ name: entry.fileName, mime: entry.mime }) ? (
              <div
                className={cn(
                  "relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-surface-muted",
                  entry.status === "error" ? "border-brick-500" : "border-line-subtle",
                )}
                role={previewable(entry) ? "button" : undefined}
                tabIndex={previewable(entry) ? 0 : undefined}
                aria-label={
                  previewable(entry)
                    ? frontendMessage("chat.attachment.filePreview", { name: entry.fileName })
                    : undefined
                }
                onClick={() => activatePreview(entry)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activatePreview(entry);
                  }
                }}
              >
                <img
                  src={entry.previewUrl}
                  alt={entry.fileName}
                  className="h-full w-full object-contain"
                  onError={() => onPreviewUnavailable(entry.id)}
                />
                {entry.status === "uploading" ? (
                  <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-ink-950/70 px-1 py-1">
                    <UploadProgressBar progress={entry.progress} className="min-w-0 flex-1 bg-paper-50/25" />
                    <span className="font-mono text-[9px] text-paper-50">{formatUploadProgress(entry.progress)}</span>
                  </span>
                ) : null}
                {entry.status === "error" ? (
                  <Tooltip content={entry.error ?? frontendMessage("ui.retry")} side="top">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRetry(entry.id);
                      }}
                      aria-label={frontendMessage("ui.retry")}
                      className="absolute bottom-1 left-1 grid h-5 w-5 place-items-center rounded-full bg-brick-50 text-brick-600 transition hover:bg-brick-100"
                    >
                      <AppIcon icon="refresh" size={12} />
                    </button>
                  </Tooltip>
                ) : null}
                <IconButton
                  label={frontendMessage("chat.attachment.remove")}
                  tooltip={entry.error ?? frontendMessage("chat.attachment.removeTooltip")}
                  tooltipSide="top"
                  size="sm"
                  className="absolute right-0.5 top-0.5 bg-ink-950/70 text-paper-50 hover:bg-ink-900"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(entry.id);
                  }}
                >
                  <AppIcon icon="close" size={12} />
                </IconButton>
              </div>
            ) : (
              <div
                className={cn(
                  "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px]",
                  entry.status === "uploading" && "min-w-[210px]",
                  entry.status === "error"
                    ? "border-brick-200 bg-brick-50 text-brick-700"
                    : "border-line-subtle bg-surface-raised text-content-secondary",
                )}
                role={previewable(entry) ? "button" : undefined}
                tabIndex={previewable(entry) ? 0 : undefined}
                aria-label={
                  previewable(entry)
                    ? frontendMessage("chat.attachment.filePreview", { name: entry.fileName })
                    : undefined
                }
                onClick={() => activatePreview(entry)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activatePreview(entry);
                  }
                }}
              >
                <span className="relative shrink-0">
                  <FilePreviewIcon name={entry.fileName} mime={entry.mime ?? entry.attachment?.mime} />
                  {entry.status === "uploading" ? (
                    <span className="absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full border border-surface-raised bg-surface-raised">
                      <Spinner size="xs" className="h-2.5 w-2.5 text-accent-content" />
                    </span>
                  ) : null}
                  {entry.status === "error" ? (
                    <span className="absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full border border-paper-50 bg-brick-50">
                      <AppIcon icon="alert-circle" size={10} className="text-brick-500" />
                    </span>
                  ) : null}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate">{entry.fileName}</span>
                    <span className="shrink-0 font-mono text-[10px] text-content-muted">
                      {formatFileSize(entry.size)}
                    </span>
                    {entry.status === "uploading" ? (
                      <span className="shrink-0 font-mono text-[10px] text-accent-content">
                        {formatUploadProgress(entry.progress)}
                      </span>
                    ) : null}
                  </span>
                  {entry.previewUnavailable ? (
                    <span className="text-[10px] text-content-muted">
                      {frontendMessage("chat.attachment.previewUnavailable")}
                    </span>
                  ) : null}
                  {entry.status === "error" ? (
                    <span className="flex min-w-0 items-center gap-1.5 text-[10px] text-brick-600">
                      <Tooltip content={entry.error ?? frontendMessage("upload.fileFailed")} side="top">
                        <span className="min-w-0 truncate">{entry.error ?? frontendMessage("upload.fileFailed")}</span>
                      </Tooltip>
                      <button
                        type="button"
                        onClick={() => onRetry(entry.id)}
                        className="shrink-0 font-medium underline underline-offset-2 hover:text-brick-700"
                      >
                        {frontendMessage("ui.retry")}
                      </button>
                    </span>
                  ) : null}
                  {entry.status === "uploading" ? <UploadProgressBar progress={entry.progress} /> : null}
                </span>
                <IconButton
                  label={frontendMessage("chat.attachment.remove")}
                  tooltip={entry.error ?? frontendMessage("chat.attachment.removeTooltip")}
                  tooltipSide="top"
                  size="sm"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(entry.id);
                  }}
                >
                  <AppIcon icon="close" size={12} />
                </IconButton>
              </div>
            )}
            {entry.previewUrl &&
            isImageFilePreview({ name: entry.fileName, mime: entry.mime }) &&
            entry.status === "error" ? (
              <p role="alert" className="mt-1 max-w-56 break-words text-[11px] leading-4 text-brick-600">
                {entry.error ?? frontendMessage("upload.fileFailed")}
              </p>
            ) : null}
          </MotionListItem>
        ))}
      </MotionList>
    </>
  );
}

function UploadProgressBar({ progress, className }: { progress?: UploadProgress; className?: string }): JSX.Element {
  const ratio = readProgressRatio(progress);
  return (
    <span className={cn("h-1 overflow-hidden rounded-full bg-surface-muted", className)}>
      <span
        className={cn(
          "block h-full origin-left rounded-full bg-accent-solid transition-transform duration-150",
          ratio === undefined && "senera-loading-pulse",
        )}
        style={{ transform: `scaleX(${ratio ?? 1})` }}
      />
    </span>
  );
}
