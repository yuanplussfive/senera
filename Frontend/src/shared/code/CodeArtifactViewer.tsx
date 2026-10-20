import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { MotionIconSwap } from "../motion";
import { useEffect, useMemo, useState } from "react";
import { cn } from "../../lib/util";
import { AppIcon, Dialog, DialogContent, Tooltip, useClipboardCopy } from "../ui";
import { CodeArtifactSourceView } from "./CodeArtifactSourceView";
import { type CodeArtifact } from "./CodeArtifactModel";
import { CodePreviewFrame } from "./CodePreviewFrame";
import { readDownloadMime } from "./CodePreviewRegistry";

interface CodeArtifactViewerProps {
  artifact: CodeArtifact;
  open: boolean;
  initialView?: ArtifactView;
  onOpenChange: (open: boolean) => void;
}

type ArtifactView = "source" | "preview";

export function CodeArtifactViewer({
  artifact,
  open,
  initialView,
  onOpenChange,
}: CodeArtifactViewerProps): JSX.Element {
  const defaultView = useMemo<ArtifactView>(() => (artifact.preview ? "preview" : "source"), [artifact.preview]);
  const [view, setView] = useState<ArtifactView>(initialView ?? defaultView);
  const [wrapped, setWrapped] = useState(false);
  const { copied, copyText } = useClipboardCopy({ successMessage: frontendMessage("code.copied") });

  useEffect(() => {
    if (!open) return;
    setView(initialView ?? defaultView);
  }, [artifact.code, defaultView, initialView, open]);

  const copyCode = async (): Promise<void> => {
    await copyText(artifact.code);
  };

  const downloadCode = (): void => {
    const blob = new Blob([artifact.code], { type: readDownloadMime(artifact.language) });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = artifact.filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <Dialog modal={false} open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={artifact.filename}
        description={`${artifact.language} · ${artifact.lineCount} lines`}
        contentInitial={false}
        className="flex h-[min(860px,calc(100vh-28px))] w-[min(1180px,calc(100vw-28px))] max-h-[calc(100vh-28px)] flex-col"
        bodyClassName="min-h-0 flex-1"
      >
        <div className="code-artifact-viewer">
          <div className="code-artifact-viewer__toolbar">
            <div className="code-artifact-viewer__tabs">
              <button
                type="button"
                className={cn("code-artifact-viewer__tab", view === "source" && "is-active")}
                onClick={() => setView("source")}
              >
                <AppIcon icon="file-code" size={14} />
                {frontendMessage("code.source")}
              </button>
              {artifact.preview ? (
                <button
                  type="button"
                  className={cn("code-artifact-viewer__tab", view === "preview" && "is-active")}
                  onClick={() => setView("preview")}
                >
                  <AppIcon icon="eye" size={14} />
                  {artifact.preview.label}
                </button>
              ) : null}
            </div>

            <div className="code-artifact-viewer__actions">
              <button
                type="button"
                className={cn("code-artifact-viewer__button", wrapped && "is-active")}
                onClick={() => setWrapped((value) => !value)}
              >
                {frontendMessage("code.wrap")}
              </button>
              <Tooltip
                content={copied ? frontendMessage("clipboard.copied") : frontendMessage("clipboard.copyToast")}
                side="top"
              >
                <button
                  type="button"
                  className="code-artifact-viewer__iconbtn"
                  onClick={copyCode}
                  aria-label={frontendMessage("code.copy")}
                >
                  <MotionIconSwap stateKey={copied ? "copied" : "copy"}>
                    {copied ? (
                      <AppIcon icon="checkmark" size={14} className="text-moss-500" />
                    ) : (
                      <AppIcon icon="copy" size={14} />
                    )}
                  </MotionIconSwap>
                </button>
              </Tooltip>
              <Tooltip content={frontendMessage("code.download")} side="top">
                <button
                  type="button"
                  className="code-artifact-viewer__iconbtn"
                  onClick={downloadCode}
                  aria-label={frontendMessage("code.downloadFile")}
                >
                  <AppIcon icon="download" size={14} />
                </button>
              </Tooltip>
            </div>
          </div>

          <div className="code-artifact-viewer__stage">
            {view === "preview" && artifact.preview ? (
              <CodePreviewFrame preview={artifact.preview} title={`${artifact.filename} preview`} />
            ) : (
              <CodeArtifactSourceView code={artifact.code} language={artifact.language} wrapped={wrapped} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
