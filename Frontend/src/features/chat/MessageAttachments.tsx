import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import type { UploadAttachmentData } from "../../api/eventTypes";
import { buildResourceContentUrl } from "../../api/uploadClient";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { isImageFilePreview } from "../../lib/filePreview";
import { cn, formatFileSize } from "../../lib/util";
import { ImagePreviewDialog } from "../../shared/media/ImagePreviewDialog";
import { IconButton } from "../../shared/ui";
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

export function MessageAttachments({ attachments, uploadUrl }: MessageAttachmentsProps): JSX.Element {
  const [failedResourceUris, setFailedResourceUris] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedResourceUri, setSelectedResourceUri] = useState<string | null>(null);
  const previewRegistry = useUploadPreviewRegistry();
  const projected = attachments.map((attachment) => ({
    attachment,
    imageCandidate: isImageFilePreview({ name: attachment.name, mime: attachment.mime }),
    canonicalSource: buildResourceContentUrl(uploadUrl, attachment.resourceUri),
    previewSource: previewRegistry.resolve(attachment.resourceUri),
  }));
  const images = projected.flatMap((item) =>
    item.imageCandidate && item.canonicalSource && !failedResourceUris.has(item.attachment.resourceUri)
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
    (item) => !item.imageCandidate || !item.canonicalSource || failedResourceUris.has(item.attachment.resourceUri),
  );
  const selectedImage = images.find((image) => image.attachment.resourceUri === selectedResourceUri) ?? null;

  const markPreviewUnavailable = (resourceUri: string): void => {
    setFailedResourceUris((current) => new Set(current).add(resourceUri));
    setSelectedResourceUri((current) => (current === resourceUri ? null : current));
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
              key={image.attachment.resourceUri}
              type="button"
              className={cn(
                "relative aspect-[4/3] min-w-0 overflow-hidden rounded-lg border border-line-subtle bg-surface-muted",
                "cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
              )}
              aria-label={frontendMessage("chat.attachment.imagePreview", { name: image.attachment.name })}
              onClick={() => setSelectedResourceUri(image.attachment.resourceUri)}
              data-message-image={image.attachment.resourceUri}
            >
              <ProgressiveMessageImage
                image={image}
                onCanonicalLoad={() => {
                  if (image.previewSource) {
                    previewRegistry.release(image.attachment.resourceUri, image.previewSource);
                  }
                }}
                onLoadError={() => {
                  if (image.previewSource) {
                    previewRegistry.release(image.attachment.resourceUri, image.previewSource);
                  }
                  markPreviewUnavailable(image.attachment.resourceUri);
                }}
              />
            </button>
          ))}
        </div>
      ) : null}

      {files.length > 0 ? (
        <div className="flex max-w-full flex-col items-end gap-1">
          {files.map(({ attachment, imageCandidate }) => (
            <AttachmentFileRow
              key={attachment.resourceUri}
              attachment={attachment}
              previewUnavailable={imageCandidate}
            />
          ))}
        </div>
      ) : null}

      {selectedImage ? (
        <AttachmentImagePreviewDialog
          key={selectedImage.attachment.resourceUri}
          image={selectedImage}
          onClose={() => setSelectedResourceUri(null)}
          onLoadError={() => markPreviewUnavailable(selectedImage.attachment.resourceUri)}
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

function AttachmentImagePreviewDialog({
  image,
  onClose,
  onLoadError,
}: {
  image: ImageAttachmentSource;
  onClose: () => void;
  onLoadError: () => void;
}): JSX.Element {
  const source = image.previewSource ?? image.canonicalSource;

  return (
    <ImagePreviewDialog
      alt={image.attachment.name}
      closeLabel={frontendMessage("ui.close")}
      labels={{
        actualSize: frontendMessage("chat.attachment.actualSize"),
        fit: frontendMessage("chat.attachment.fitImage"),
        zoomIn: frontendMessage("chat.attachment.zoomIn"),
        zoomOut: frontendMessage("chat.attachment.zoomOut"),
      }}
      open
      source={source}
      title={frontendMessage("chat.attachment.imagePreview", { name: image.attachment.name })}
      onError={onLoadError}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      headerActions={
        <IconButton
          label={frontendMessage("chat.attachment.downloadImage")}
          tooltip={frontendMessage("chat.attachment.downloadImage")}
          tooltipSide="bottom"
          size="md"
          className="text-content-secondary hover:bg-surface-hover hover:text-content-primary"
          onClick={() => {
            void downloadImage(image.canonicalSource, image.attachment.name).catch(() => {
              toast.error(frontendMessage("chat.attachment.downloadFailed"));
            });
          }}
        >
          <Download className="h-4 w-4" />
        </IconButton>
      }
    />
  );
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
