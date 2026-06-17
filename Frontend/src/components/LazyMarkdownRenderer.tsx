import { lazy, Suspense } from "react";
import { cn } from "../lib/util";
import type { MarkdownRendererProps } from "./MarkdownRenderer";

const LazyMarkdownRendererImpl = lazy(() =>
  import("./MarkdownRenderer").then((module) => ({
    default: module.MarkdownRenderer,
  })),
);

export function LazyMarkdownRenderer({
  children,
  className,
  contentClassName,
  compact,
  lightweightCode,
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
          >
            {children}
          </p>
        </div>
      }
    >
      <LazyMarkdownRendererImpl
        className={className}
        contentClassName={contentClassName}
        compact={compact}
        lightweightCode={lightweightCode}
      >
        {children}
      </LazyMarkdownRendererImpl>
    </Suspense>
  );
}

function isPlainTextMarkdown(value: string): boolean {
  return !/(^|\n)\s{0,3}(```|#{1,6}\s|[-*+]\s|\d+\.\s|>\s|[-*_]{3,}\s*$)|https?:\/\/|www\.|[*_~`[\]<|]/.test(value);
}
