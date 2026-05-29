import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Download, Eye, FileCode } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../lib/util";
import { type CodeArtifact } from "./CodeArtifactModel";
import { CodeArtifactSourceView } from "./CodeArtifactSourceView";
import { readDownloadMime } from "./CodePreviewRegistry";
import { Dialog, DialogContent } from "./ui/Dialog";
import { Tooltip } from "./ui/Tooltip";

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
  const defaultView = useMemo<ArtifactView>(
    () => (artifact.preview ? "preview" : "source"),
    [artifact.preview],
  );
  const [view, setView] = useState<ArtifactView>(initialView ?? defaultView);
  const [wrapped, setWrapped] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView(initialView ?? defaultView);
  }, [artifact.code, defaultView, initialView, open]);

  const copyCode = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(artifact.code);
      setCopied(true);
      toast.success("代码已复制");
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("复制失败");
    }
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={artifact.filename}
        description={`${artifact.language} · ${artifact.lineCount} lines`}
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
                <FileCode className="h-3.5 w-3.5" />
                源码
              </button>
              {artifact.preview ? (
                <button
                  type="button"
                  className={cn("code-artifact-viewer__tab", view === "preview" && "is-active")}
                  onClick={() => setView("preview")}
                >
                  <Eye className="h-3.5 w-3.5" />
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
                自动换行
              </button>
              <Tooltip content={copied ? "已复制" : "复制"} side="top">
                <button
                  type="button"
                  className="code-artifact-viewer__iconbtn"
                  onClick={copyCode}
                  aria-label="复制代码"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-moss-500" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </Tooltip>
              <Tooltip content="下载" side="top">
                <button
                  type="button"
                  className="code-artifact-viewer__iconbtn"
                  onClick={downloadCode}
                  aria-label="下载代码文件"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </div>
          </div>

          <div className="code-artifact-viewer__stage">
            {view === "preview" && artifact.preview ? (
              <iframe
                className="code-artifact-viewer__preview"
                title={`${artifact.filename} preview`}
                sandbox={artifact.preview.sandbox}
                srcDoc={artifact.preview.source}
              />
            ) : (
              <CodeArtifactSourceView
                code={artifact.code}
                language={artifact.language}
                wrapped={wrapped}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
