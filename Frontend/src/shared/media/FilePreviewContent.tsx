import { useEffect, useState } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { FilePreviewDescriptor } from "../../lib/filePreview";
import { cn } from "../../lib/util";
import { AppIcon, Spinner } from "../ui";
import { OpenWithDefaultAppButton } from "./OpenWithDefaultAppButton";

const TextPreviewLimitBytes = 128 * 1024;
const TextPreviewLimitCharacters = 16_000;

export function FilePreviewContent({
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
  if (profile.renderKind === "audio" && source) {
    return <audio className="w-full" controls preload="metadata" src={source} />;
  }
  if (profile.renderKind === "video" && source) {
    return (
      <video
        className="max-h-[min(65vh,34rem)] w-full bg-black object-contain"
        controls
        preload="metadata"
        src={source}
      />
    );
  }
  if (profile.renderKind === "pdf" && source) {
    return (
      <iframe
        className="h-[min(70vh,40rem)] w-full rounded-md border border-line-subtle bg-white"
        src={source}
        title={frontendMessage("chat.attachment.filePreview", { name })}
      />
    );
  }
  if (profile.renderKind === "text" || profile.renderKind === "diff") {
    return <TextPreviewBody file={file} source={source} />;
  }
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-line-subtle bg-surface-muted px-6 py-8 text-center">
      <AppIcon icon={profile.icon} size={28} className="text-content-muted" />
      <p className="text-[13px] font-medium text-content-primary">{frontendMessage("chat.attachment.binaryPreview")}</p>
      <p className="max-w-md text-[11px] leading-5 text-content-muted">
        {frontendMessage("resource.downloadDescription")}
      </p>
      <OpenWithDefaultAppButton name={name} source={source} variant="labeled" className="mt-1" />
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
        if (controller.signal.aborted) return;
        const truncated = text.length > TextPreviewLimitCharacters;
        setState({
          status: "ready",
          text: truncated ? `${text.slice(0, TextPreviewLimitCharacters)}\n…` : text,
          truncated,
        });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
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
