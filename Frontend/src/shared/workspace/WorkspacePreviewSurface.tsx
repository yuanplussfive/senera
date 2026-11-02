import { useEffect, useState } from "react";
import { toast } from "sonner";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { downloadBlob, downloadUrl } from "../../lib/download";
import { resolveFilePreview } from "../../lib/filePreview";
import { formatFileSize } from "../../lib/util";
import { FilePreviewContent } from "../media/FilePreviewContent";
import { ImageCanvasViewer } from "../media/ImageCanvasViewer";
import { AppIcon, IconButton, Spinner } from "../ui";
import type { WorkspacePreviewResource } from "./WorkspacePreviewResource";

export default function WorkspacePreviewSurface({
  resource,
}: {
  readonly resource: WorkspacePreviewResource;
}): JSX.Element {
  const { file, name } = resource;
  const mime = resource.mime ?? file?.type;
  const size = resource.size ?? file?.size;
  const detectedProfile = resolveFilePreview({ name, mime });
  const profile = { ...detectedProfile, renderKind: resource.previewKind ?? detectedProfile.renderKind };
  const [source, setSource] = useState(file ? undefined : resource.source);

  useEffect(() => {
    if (!file) {
      setSource(resource.source);
      return;
    }
    // Own the URL for the lifetime of the tab; removing a draft must not break its preview.
    const url = URL.createObjectURL(file);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [file, resource.source]);

  const download = (): void => {
    const request = file ? downloadBlob(file, name) : source ? downloadUrl(source, name) : undefined;
    void request?.catch(() => toast.error(frontendMessage("chat.attachment.downloadFailed")));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-panel" data-workspace-resource-preview={profile.renderKind}>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line-subtle px-3">
        <span className="min-w-0 flex-1 truncate text-xs text-content-muted">
          {mime || profile.label}
          {size !== undefined ? ` · ${formatFileSize(size)}` : ""}
        </span>
        <IconButton
          label={frontendMessage("chat.attachment.downloadFile")}
          tooltip={frontendMessage("chat.attachment.downloadFile")}
          size="sm"
          disabled={!file && !source}
          onClick={download}
        >
          <AppIcon icon="download" size={14} />
        </IconButton>
      </div>
      {profile.renderKind === "image" ? (
        source ? (
          <ImageCanvasViewer
            alt={name}
            source={source}
            className="min-h-0 flex-1"
            labels={{
              actualSize: frontendMessage("chat.attachment.actualSize"),
              fit: frontendMessage("chat.attachment.fitImage"),
              zoomIn: frontendMessage("chat.attachment.zoomIn"),
              zoomOut: frontendMessage("chat.attachment.zoomOut"),
            }}
          />
        ) : (
          <div className="grid flex-1 place-items-center" aria-busy="true">
            <Spinner size="sm" />
          </div>
        )
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <FilePreviewContent file={file} profile={profile} source={source} name={name} />
        </div>
      )}
    </div>
  );
}
