import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { buildWorkspaceResourceUrl } from "../../api/workspaceResourceClient";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { AppIcon } from "../ui";
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
  const [loaded, setLoaded] = useState(false);
  const source = controller ? buildWorkspaceResourceUrl(controller.httpBaseUrl, locator.path, true) : undefined;

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [source]);

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
          className={cn(
            "markdown-renderer__image max-w-full object-contain transition-transform duration-150 [@media(hover:hover)_and_(pointer:fine)]:group-hover:scale-[1.01]",
            !loaded && "sr-only",
          )}
          loading="lazy"
          decoding="async"
          fetchPriority="low"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : null}
      {!source || failed || !loaded ? (
        <span className="flex items-center gap-2 px-4 py-6 text-[12px] text-content-muted">
          <AppIcon icon="image" size={16} aria-hidden="true" />
          <span className="max-w-56 truncate">
            {failed ? alt || locator.path : loaded ? alt || locator.path : frontendMessage("ui.loading")}
          </span>
        </span>
      ) : null}
    </button>
  );
}
