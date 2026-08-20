import { Image as ImageIcon } from "lucide-react";
import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { readWorkspaceResourceBlob } from "../../api/workspaceResourceClient";
import { cn } from "../../lib/util";
import type { WorkspaceResourceLocator } from "./WorkspaceResourceLocator";
import { useWorkspaceResourceController } from "./WorkspaceResourceProvider";

export function WorkspaceMarkdownImage({
  alt,
  className,
  locator,
}: ImgHTMLAttributes<HTMLImageElement> & {
  readonly locator: WorkspaceResourceLocator;
}): JSX.Element {
  const controller = useWorkspaceResourceController();
  const [source, setSource] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!controller) return;
    const abort = new AbortController();
    let objectUrl: string | undefined;
    setSource(undefined);
    setFailed(false);
    void readWorkspaceResourceBlob(controller.httpBaseUrl, locator.path)
      .then((blob) => {
        if (abort.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      });
    return () => {
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [controller, locator.path]);

  return (
    <button
      type="button"
      className={cn(
        "group relative my-2 inline-grid min-h-24 min-w-32 max-w-full place-items-center overflow-hidden rounded-md border border-line bg-surface-subtle",
        "cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
        className,
      )}
      onClick={() => controller?.openResource(locator)}
      aria-label={alt || locator.path}
    >
      {source ? (
        <img
          src={source}
          alt={alt ?? ""}
          className="markdown-renderer__image max-w-full object-contain transition-transform duration-150 group-hover:scale-[1.01]"
        />
      ) : (
        <span className="flex items-center gap-2 px-4 py-6 text-[12px] text-content-muted">
          <ImageIcon className="h-4 w-4" />
          <span className="max-w-56 truncate">{failed ? alt || locator.path : alt || locator.path}</span>
        </span>
      )}
    </button>
  );
}
