import { Image as ImageIcon } from "lucide-react";
import { useState, type ImgHTMLAttributes } from "react";
import { buildWorkspaceResourceUrl } from "../../api/workspaceResourceClient";
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
  const [failed, setFailed] = useState(false);
  const source = controller ? buildWorkspaceResourceUrl(controller.httpBaseUrl, locator.path, true) : undefined;

  return (
    <button
      type="button"
      className={cn(
        "markdown-renderer__image-trigger group relative min-h-24 min-w-32 place-items-center rounded-md border border-line",
        "cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
        className,
      )}
      onClick={() => controller?.openResource(locator)}
      aria-label={alt || locator.path}
    >
      {source && !failed ? (
        <img
          src={source}
          alt={alt ?? ""}
          className="markdown-renderer__image max-w-full object-contain transition-transform duration-150 [@media(hover:hover)_and_(pointer:fine)]:group-hover:scale-[1.01]"
          loading="lazy"
          decoding="async"
          fetchPriority="low"
          onError={() => setFailed(true)}
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
