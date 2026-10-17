import { useEffect, useState } from "react";
import { toast } from "sonner";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { downloadUrl } from "../../lib/download";
import { resolveFilePreview, type FilePreviewDescriptor } from "../../lib/filePreview";
import { cn, formatFileSize } from "../../lib/util";
import { Dialog, DialogContent, IconButton, AppIcon, Spinner } from "../ui";
import { ImagePreviewDialog } from "./ImagePreviewDialog";

const TextPreviewLimitBytes = 128 * 1024;
const TextPreviewLimitCharacters = 16_000;

export interface FilePreviewDialogProps {
  readonly file?: File;
  readonly mime?: string;
  readonly name: string;
  readonly size?: number;
  readonly source?: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * The attachment preview contract is deliberately driven by the file profile,
 * so composer files and persisted message resources render through one path.
 */
export function FilePreviewDialog({
  file,
  mime,
  name,
  size,
  source,
  open,
  onOpenChange,
}: FilePreviewDialogProps): JSX.Element | null {
  const profile = resolveFilePreview({ name, mime });
  const title = frontendMessage("chat.attachment.filePreview", { name });
  const download = (): void => {
    void downloadAttachment({ file, name, source }).catch(() => {
      toast.error(frontendMessage("chat.attachment.downloadFailed"));
    });
  };
  const downloadAction =
    source || file ? (
      <IconButton
        label={frontendMessage("chat.attachment.downloadFile")}
        tooltip={frontendMessage("chat.attachment.downloadFile")}
        tooltipSide="bottom"
        size="md"
        className="text-content-secondary hover:bg-surface-hover hover:text-content-primary"
        onClick={download}
      >
        <AppIcon icon="download" size={16} />
      </IconButton>
    ) : null;

  if (profile.id === "image" && source) {
    return (
      <ImagePreviewDialog
        alt={name}
        closeLabel={frontendMessage("ui.close")}
        headerActions={downloadAction}
        labels={{
          actualSize: frontendMessage("chat.attachment.actualSize"),
          fit: frontendMessage("chat.attachment.fitImage"),
          zoomIn: frontendMessage("chat.attachment.zoomIn"),
          zoomOut: frontendMessage("chat.attachment.zoomOut"),
        }}
        open={open}
        source={source}
        title={frontendMessage("chat.attachment.imagePreview", { name })}
        onOpenChange={onOpenChange}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        showHeader={false}
        className="w-[min(760px,calc(100vw-2rem))]"
        bodyClassName="flex min-h-0 flex-1 flex-col"
        data-file-preview-dialog
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-line-subtle px-5 py-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-hover text-content-secondary">
              <AppIcon icon={profile.icon} size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-content-primary" title={name}>
                {name}
              </p>
              <p className="truncate text-[11px] text-content-muted">
                {mime || profile.label}
                {size !== undefined ? ` · ${formatFileSize(size)}` : ""}
              </p>
            </div>
            {downloadAction}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4" data-file-preview-content={profile.id}>
            <FilePreviewBody file={file} profile={profile} source={source} name={name} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FilePreviewBody({
  file,
  profile,
  source,
  name,
}: {
  readonly file?: File;
  readonly profile: FilePreviewDescriptor;
  readonly source?: string;
  readonly name: string;
}): JSX.Element {
  if (profile.id === "audio" && source) {
    return <audio className="w-full" controls preload="metadata" src={source} />;
  }
  if (profile.id === "video" && source) {
    return (
      <video
        className="max-h-[min(65vh,34rem)] w-full bg-black object-contain"
        controls
        preload="metadata"
        src={source}
      />
    );
  }
  if (profile.id === "pdf" && source) {
    return (
      <iframe
        className="h-[min(70vh,40rem)] w-full rounded-md border border-line-subtle bg-white"
        src={source}
        title={frontendMessage("chat.attachment.filePreview", { name })}
      />
    );
  }
  if (profile.contentKind === "text") {
    return <TextPreviewBody file={file} source={source} />;
  }
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-line-subtle bg-surface-muted px-6 py-8 text-center">
      <AppIcon icon={profile.icon} size={28} className="text-content-muted" />
      <p className="text-[13px] font-medium text-content-primary">{frontendMessage("chat.attachment.binaryPreview")}</p>
      <p className="max-w-md text-[11px] leading-5 text-content-muted">
        {frontendMessage("resource.downloadDescription")}
      </p>
    </div>
  );
}

function TextPreviewBody({ file, source }: { file?: File; source?: string }): JSX.Element {
  const [state, setState] = useState<TextPreviewState>({ status: "loading" });

  useEffect(() => {
    if (file && file.size > TextPreviewLimitBytes) {
      setState({ status: "ready", text: "", truncated: true });
      return;
    }
    if (!file && !source) {
      setState({ status: "error" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    const read = file
      ? file.text()
      : fetch(source!, { credentials: "include", signal: controller.signal }).then(async (response) => {
          if (!response.ok) throw new Error(`Attachment preview failed with status ${response.status}.`);
          return response.text();
        });
    void read.then(
      (text) => {
        const truncated = text.length > TextPreviewLimitCharacters;
        setState({
          status: "ready",
          text: truncated ? `${text.slice(0, TextPreviewLimitCharacters)}\n…` : text,
          truncated,
        });
      },
      (error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error" });
      },
    );
    return () => controller.abort();
  }, [file, source]);

  if (state.status === "loading") {
    return (
      <div className="flex min-h-40 items-center justify-center text-content-muted" aria-busy="true">
        <Spinner size="sm" />
      </div>
    );
  }
  if (state.status === "ready") {
    return (
      <div className="min-w-0">
        {state.text ? (
          <pre
            className={cn(
              "max-h-[min(70vh,42rem)] overflow-auto whitespace-pre-wrap wrap-anywhere rounded-md bg-surface-muted p-4 font-mono text-[12px] leading-5 text-content-primary",
            )}
          >
            {state.text}
          </pre>
        ) : null}
        {state.truncated ? (
          <p className="mt-2 text-[11px] text-content-muted">{frontendMessage("chat.attachment.previewTruncated")}</p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex min-h-40 items-center justify-center rounded-md border border-line-subtle bg-surface-muted px-6 py-8 text-center text-[12px] text-content-muted">
      {frontendMessage("chat.attachment.previewFailed")}
    </div>
  );
}

type TextPreviewState =
  | { readonly status: "loading" | "error" }
  | { readonly status: "ready"; readonly text: string; readonly truncated: boolean };

async function downloadAttachment({
  file,
  name,
  source,
}: {
  readonly file?: File;
  readonly name: string;
  readonly source?: string;
}): Promise<void> {
  if (source) {
    await downloadUrl(source, name);
    return;
  }
  if (!file) return;
  const localUrl = URL.createObjectURL(file);
  try {
    const anchor = document.createElement("a");
    anchor.href = localUrl;
    anchor.download = name;
    anchor.click();
  } finally {
    URL.revokeObjectURL(localUrl);
  }
}
