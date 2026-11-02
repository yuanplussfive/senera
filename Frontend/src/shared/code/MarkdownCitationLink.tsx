import { useState, type AnchorHTMLAttributes, type ReactNode } from "react";
import { AppIcon } from "../ui/AppIcon";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";
import { openExternalUrl } from "../../app/desktopBridge";
import { toast } from "sonner";

export interface MarkdownCitationLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href?: string;
  node?: unknown;
  children?: ReactNode;
}

export function MarkdownCitationLink({
  href,
  children: _children,
  className,
  node: _node,
  title,
  onClick,
  ...props
}: MarkdownCitationLinkProps): JSX.Element {
  const metadata = readCitationUrl(href);
  const [open, setOpen] = useState(false);
  if (!metadata) {
    return (
      <a {...props} href={href} className={className}>
        {_children}
      </a>
    );
  }

  const sourceTitle = typeof title === "string" ? title.trim() : "";
  const ariaLabel = frontendMessage("markdown.citation.view", { host: metadata.label });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <a
          {...props}
          href={href}
          className={cn("markdown-renderer__citation", className)}
          data-link-kind="external-citation"
          target="_blank"
          rel="noreferrer noopener"
          aria-label={props["aria-label"] ?? ariaLabel}
          aria-haspopup="dialog"
          onClick={(event) => {
            onClick?.(event);
            if (
              !event.defaultPrevented &&
              event.button === 0 &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.shiftKey &&
              !event.altKey
            ) {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          <span className="markdown-renderer__citation-host">{metadata.label}</span>
        </a>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="markdown-renderer__citation-popover w-[min(24rem,calc(100vw-2rem))] p-0"
        aria-label={frontendMessage("markdown.citation.details")}
      >
        <div className="px-3.5 py-3">
          <div className="flex min-w-0 items-center gap-2 text-[12px] text-content-secondary">
            <span className="min-w-0 truncate font-medium text-content-primary">{metadata.label}</span>
            <span className="shrink-0 text-content-muted">{frontendMessage("markdown.citation.source")}</span>
          </div>
          {sourceTitle ? <div className="mt-2 text-[13px] font-medium text-content-primary">{sourceTitle}</div> : null}
          <div className="mt-2 break-all font-mono text-[11px] leading-5 text-content-muted">{href}</div>
        </div>
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(event) => {
            event.preventDefault();
            void openExternalUrl(href!).then((result) => {
              if (result === "blocked") toast.error(frontendMessage("link.openFailed"));
            });
          }}
          className="flex items-center justify-between border-t border-line-subtle px-3.5 py-2.5 text-[12px] font-medium text-accent-content transition-colors hover:bg-surface-hover hover:text-accent-content-hover"
        >
          <span>{frontendMessage("markdown.citation.open")}</span>
          <AppIcon icon="external-link" className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </PopoverContent>
    </Popover>
  );
}

interface CitationUrlMetadata {
  host: string;
  label: string;
}

function readCitationUrl(href: string | undefined): CitationUrlMetadata | undefined {
  if (!href || !/^https?:\/\//i.test(href)) return undefined;

  try {
    const url = new URL(href);
    const host = url.host.replace(/^www\./i, "");
    if (!host) return undefined;

    const hasLocationDetail = url.pathname !== "/" || Boolean(url.search || url.hash);
    const suffix = `${hasLocationDetail ? url.pathname : ""}${url.search}${url.hash}`;
    return { host, label: compactCitationLabel(`${host}${suffix}`, host) };
  } catch {
    return undefined;
  }
}

function compactCitationLabel(value: string, host: string): string {
  const maxLength = 48;
  if (value.length <= maxLength) return value;

  const suffix = value.slice(host.length);
  const tailLength = Math.max(12, maxLength - host.length - 2);
  return `${host}/…${suffix.slice(-tailLength)}`;
}
