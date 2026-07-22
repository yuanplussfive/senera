import { useRef, useState } from "react";
import { Download, Maximize2, Scan, X, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import type { UploadAttachmentData } from "../../api/eventTypes";
import { buildUploadContentUrl } from "../../api/uploadClient";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { isImageFilePreview } from "../../lib/filePreview";
import { cn } from "../../lib/util";
import { Dialog, DialogContent, IconButton } from "../../shared/ui";
import { FilePreviewIcon } from "./FilePreviewIcon";
import { useUploadPreviewRegistry } from "./UploadPreviewRegistry";

interface MessageAttachmentsProps {
  attachments: readonly UploadAttachmentData[];
  uploadUrl: string;
}

interface ImageAttachmentSource {
  attachment: UploadAttachmentData;
  canonicalSource: string;
  previewSource?: string;
}

const ImageViewerScale = {
  min: 0.1,
  max: 8,
  step: 0.25,
} as const;

type ImageViewerScaleValue = "fit" | number;

export function MessageAttachments({ attachments, uploadUrl }: MessageAttachmentsProps): JSX.Element {
  const [failedUploadUris, setFailedUploadUris] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedUploadUri, setSelectedUploadUri] = useState<string | null>(null);
  const previewRegistry = useUploadPreviewRegistry();
  const projected = attachments.map((attachment) => ({
    attachment,
    imageCandidate: isImageFilePreview({ name: attachment.name, mime: attachment.mime }),
    canonicalSource: buildUploadContentUrl(uploadUrl, attachment.uploadUri),
    previewSource: previewRegistry.resolve(attachment.uploadUri),
  }));
  const images = projected.flatMap((item) =>
    item.imageCandidate && item.canonicalSource && !failedUploadUris.has(item.attachment.uploadUri)
      ? [
          {
            attachment: item.attachment,
            canonicalSource: item.canonicalSource,
            previewSource: item.previewSource,
          },
        ]
      : [],
  );
  const files = projected.filter(
    (item) => !item.imageCandidate || !item.canonicalSource || failedUploadUris.has(item.attachment.uploadUri),
  );
  const selectedImage = images.find((image) => image.attachment.uploadUri === selectedUploadUri) ?? null;

  const markPreviewUnavailable = (uploadUri: string): void => {
    setFailedUploadUris((current) => new Set(current).add(uploadUri));
    setSelectedUploadUri((current) => (current === uploadUri ? null : current));
  };

  return (
    <div className="mt-1 flex max-w-full flex-col items-end gap-1.5">
      {images.length > 0 ? (
        <div
          className={cn(
            "grid max-w-[calc(100vw-5.5rem)] gap-1.5",
            images.length === 1 ? "w-[280px] grid-cols-1" : "w-[420px] grid-cols-2",
          )}
          data-message-image-gallery
        >
          {images.map((image) => (
            <button
              key={image.attachment.uploadUri}
              type="button"
              className={cn(
                "relative aspect-[4/3] min-w-0 overflow-hidden rounded-lg border border-line-subtle bg-surface-muted",
                "cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
              )}
              aria-label={frontendMessage("chat.attachment.imagePreview", { name: image.attachment.name })}
              onClick={() => setSelectedUploadUri(image.attachment.uploadUri)}
              data-message-image={image.attachment.uploadUri}
            >
              <ProgressiveMessageImage
                image={image}
                onCanonicalLoad={() => {
                  if (image.previewSource) {
                    previewRegistry.release(image.attachment.uploadUri, image.previewSource);
                  }
                }}
                onLoadError={() => {
                  if (image.previewSource) {
                    previewRegistry.release(image.attachment.uploadUri, image.previewSource);
                  }
                  markPreviewUnavailable(image.attachment.uploadUri);
                }}
              />
            </button>
          ))}
        </div>
      ) : null}

      {files.length > 0 ? (
        <div className="flex max-w-full flex-col items-end gap-1">
          {files.map(({ attachment, imageCandidate }) => (
            <AttachmentFileRow key={attachment.uploadUri} attachment={attachment} previewUnavailable={imageCandidate} />
          ))}
        </div>
      ) : null}

      {selectedImage ? (
        <ImagePreviewDialog
          key={selectedImage.attachment.uploadUri}
          image={selectedImage}
          onClose={() => setSelectedUploadUri(null)}
          onLoadError={() => markPreviewUnavailable(selectedImage.attachment.uploadUri)}
        />
      ) : null}
    </div>
  );
}

function ProgressiveMessageImage({
  image,
  onCanonicalLoad,
  onLoadError,
}: {
  image: ImageAttachmentSource;
  onCanonicalLoad: () => void;
  onLoadError: () => void;
}): JSX.Element {
  const [canonicalReady, setCanonicalReady] = useState(false);
  const awaitingCanonicalSource = Boolean(image.previewSource && !canonicalReady);

  return (
    <span className="absolute inset-0 block">
      <img
        src={image.canonicalSource}
        alt={image.attachment.name}
        className={cn("h-full w-full object-contain", awaitingCanonicalSource && "opacity-0")}
        loading={image.previewSource ? "eager" : "lazy"}
        decoding="async"
        onLoad={() => {
          setCanonicalReady(true);
          onCanonicalLoad();
        }}
        onError={onLoadError}
        data-message-image-source="canonical"
      />
      {awaitingCanonicalSource ? (
        <img
          src={image.previewSource}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-contain"
          data-message-image-source="ephemeral"
        />
      ) : null}
    </span>
  );
}

function AttachmentFileRow({
  attachment,
  previewUnavailable,
}: {
  attachment: UploadAttachmentData;
  previewUnavailable: boolean;
}): JSX.Element {
  return (
    <div
      className="flex max-w-full items-center gap-1.5 rounded-md border border-line-subtle bg-surface-raised px-2 py-1 text-[11px] text-content-secondary"
      data-attachment-preview-unavailable={previewUnavailable || undefined}
    >
      <FilePreviewIcon name={attachment.name} mime={attachment.mime} />
      <span className="min-w-0 truncate">{attachment.name}</span>
      <span className="shrink-0 font-mono text-[10px] text-content-muted">
        {previewUnavailable
          ? frontendMessage("chat.attachment.previewUnavailable")
          : `${attachment.mime} · ${formatFileSize(attachment.size)}`}
      </span>
    </div>
  );
}

function ImagePreviewDialog({
  image,
  onClose,
  onLoadError,
}: {
  image: ImageAttachmentSource;
  onClose: () => void;
  onLoadError: () => void;
}): JSX.Element {
  const [scale, setScale] = useState<ImageViewerScaleValue>("fit");
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const controlClassName = "text-content-secondary hover:bg-surface-hover hover:text-content-primary";
  const source = image.previewSource ?? image.canonicalSource;

  const changeScale = (delta: number): void => {
    const currentScale = scale === "fit" ? readRenderedImageScale(imageRef.current) : scale;
    setScale(Math.min(ImageViewerScale.max, Math.max(ImageViewerScale.min, currentScale + delta)));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={frontendMessage("chat.attachment.imagePreview", { name: image.attachment.name })}
        showClose={false}
        showHeader={false}
        placement="inset"
        motionPreset="focus"
        frameClassName="inset-2 sm:inset-4"
        className="h-full !max-h-none w-full max-w-none"
        bodyClassName="flex min-h-0 flex-1 flex-col"
        data-image-preview-dialog
        aria-describedby={undefined}
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line-subtle px-2 sm:px-3">
          <span
            className="min-w-0 flex-1 truncate px-1 text-[12px] text-content-secondary"
            title={image.attachment.name}
          >
            {image.attachment.name}
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton
              label={frontendMessage("chat.attachment.zoomOut")}
              tooltip={frontendMessage("chat.attachment.zoomOut")}
              tooltipSide="bottom"
              size="md"
              className={controlClassName}
              disabled={scale !== "fit" && scale <= ImageViewerScale.min}
              onClick={() => changeScale(-ImageViewerScale.step)}
            >
              <ZoomOut className="h-4 w-4" />
            </IconButton>
            <IconButton
              label={frontendMessage("chat.attachment.fitImage")}
              tooltip={frontendMessage("chat.attachment.fitImage")}
              tooltipSide="bottom"
              size="md"
              className={controlClassName}
              onClick={() => setScale("fit")}
            >
              <Maximize2 className="h-4 w-4" />
            </IconButton>
            <IconButton
              label={frontendMessage("chat.attachment.zoomIn")}
              tooltip={frontendMessage("chat.attachment.zoomIn")}
              tooltipSide="bottom"
              size="md"
              className={controlClassName}
              disabled={scale !== "fit" && scale >= ImageViewerScale.max}
              onClick={() => changeScale(ImageViewerScale.step)}
            >
              <ZoomIn className="h-4 w-4" />
            </IconButton>
            <IconButton
              label={frontendMessage("chat.attachment.actualSize")}
              tooltip={frontendMessage("chat.attachment.actualSize")}
              tooltipSide="bottom"
              size="md"
              className={controlClassName}
              disabled={scale === 1}
              onClick={() => setScale(1)}
            >
              <Scan className="h-4 w-4" />
            </IconButton>
            <IconButton
              label={frontendMessage("chat.attachment.downloadImage")}
              tooltip={frontendMessage("chat.attachment.downloadImage")}
              tooltipSide="bottom"
              size="md"
              className={controlClassName}
              onClick={() => {
                void downloadImage(image.canonicalSource, image.attachment.name).catch(() => {
                  toast.error(frontendMessage("chat.attachment.downloadFailed"));
                });
              }}
            >
              <Download className="h-4 w-4" />
            </IconButton>
            <IconButton
              label={frontendMessage("desktop.window.close")}
              tooltip={frontendMessage("desktop.window.close")}
              tooltipSide="bottom"
              size="md"
              className={controlClassName}
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-surface-muted p-3 sm:p-5">
          <div className="grid min-h-full min-w-full place-items-center overflow-visible">
            <img
              ref={imageRef}
              src={source}
              alt={image.attachment.name}
              className={cn(
                "block shrink-0 object-contain",
                scale === "fit" && "max-h-[calc(100dvh-6.5rem)] max-w-full",
              )}
              style={
                scale !== "fit" && naturalSize
                  ? { width: naturalSize.width * scale, height: naturalSize.height * scale, maxWidth: "none" }
                  : undefined
              }
              onLoad={(event) => {
                setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
              }}
              onError={onLoadError}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function readRenderedImageScale(image: HTMLImageElement | null): number {
  if (!image || image.naturalWidth <= 0) return 1;
  return image.getBoundingClientRect().width / image.naturalWidth;
}

async function downloadImage(source: string, fileName: string): Promise<void> {
  const response = await fetch(source, { credentials: "include" });
  if (!response.ok) {
    throw new Error(frontendMessage("chat.attachment.downloadFailed"));
  }
  const downloadUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = fileName;
  link.rel = "noopener";
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  requestAnimationFrame(() => URL.revokeObjectURL(downloadUrl));
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)}KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)}MB`;
}
