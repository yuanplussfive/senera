import { lazy, Suspense } from "react";
import { cn } from "../../lib/util";
import type { MarkdownRendererProps } from "./MarkdownRenderer";

let markdownRendererModule: Promise<typeof import("./MarkdownRenderer")> | undefined;

const LazyMarkdownRendererImpl = lazy(() =>
  loadMarkdownRenderer().then((module) => ({
    default: module.MarkdownRenderer,
  })),
);

export function preloadMarkdownRenderer(): Promise<void> {
  return loadMarkdownRenderer().then(() => undefined);
}

export function LazyMarkdownRenderer({
  children,
  className,
  contentClassName,
  contentStyle,
  compact,
  lightweightCode,
  externalLinkPresentation,
}: MarkdownRendererProps): JSX.Element {
  if (isPlainTextMarkdown(children)) {
    return (
      <div className={className}>
        <p
          className={cn(
            "markdown-renderer whitespace-pre-wrap break-words",
            compact && "markdown-renderer--compact",
            compact && "text-[13px]",
            contentClassName,
          )}
          style={contentStyle}
        >
          {children}
        </p>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className={className}>
          <p
            className={cn(
              "markdown-renderer whitespace-pre-wrap break-words",
              compact && "markdown-renderer--compact",
              compact && "text-[13px]",
              contentClassName,
            )}
            style={contentStyle}
          >
            {children}
          </p>
        </div>
      }
    >
      <LazyMarkdownRendererImpl
        className={className}
        contentClassName={contentClassName}
        contentStyle={contentStyle}
        compact={compact}
        lightweightCode={lightweightCode}
        externalLinkPresentation={externalLinkPresentation}
      >
        {children}
      </LazyMarkdownRendererImpl>
    </Suspense>
  );
}

function isPlainTextMarkdown(value: string): boolean {
  return !/(^|\n)\s{0,3}(```|#{1,6}\s|[-*+]\s|\d+\.\s|>\s|[-*_]{3,}\s*$)|https?:\/\/|www\.|[*_~`[\]<|]/.test(value);
}

function loadMarkdownRenderer(): Promise<typeof import("./MarkdownRenderer")> {
  markdownRendererModule ??= import("./MarkdownRenderer");
  return markdownRendererModule;
}
