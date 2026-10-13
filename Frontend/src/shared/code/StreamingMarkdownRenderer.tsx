import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/util";
import type { MarkdownRendererProps } from "./MarkdownRenderer";

const LazyMarkdownRenderer = lazy(() =>
  import("./MarkdownRenderer").then((module) => ({ default: module.MarkdownRenderer })),
);

/** Keep parsing on a frame-sized cadence so a fast provider stream cannot
 * force a full Markdown tree/layout pass for every delta. */
export const StreamingMarkdownRenderCadenceMs = 64;

export function StreamingMarkdownRenderer({
  children,
  className,
  contentClassName,
  contentStyle,
  compact,
  externalLinkPresentation,
}: Omit<MarkdownRendererProps, "lightweightCode">): JSX.Element {
  const renderedContent = useStreamingMarkdownContent(children);
  return (
    <div
      className={cn("min-w-0", className)}
      data-assistant-streaming-body
      data-streaming-markdown-renderer
      aria-live="polite"
    >
      <Suspense fallback={<StreamingMarkdownFallback content={renderedContent} className={contentClassName} />}>
        <LazyMarkdownRenderer
          className="min-w-0"
          contentClassName={contentClassName}
          contentStyle={contentStyle}
          compact={compact}
          lightweightCode
          externalLinkPresentation={externalLinkPresentation}
        >
          {renderedContent}
        </LazyMarkdownRenderer>
      </Suspense>
      <span className="caret-blink" aria-hidden="true" />
    </div>
  );
}

function StreamingMarkdownFallback({ content, className }: { content: string; className?: string }): JSX.Element {
  return <div className={cn("markdown-renderer whitespace-pre-wrap break-words", className)}>{content}</div>;
}

function useStreamingMarkdownContent(content: string): string {
  const [renderedContent, setRenderedContent] = useState(content);
  const latestContentRef = useRef(content);
  const timerRef = useRef<number | undefined>(undefined);
  latestContentRef.current = content;

  useEffect(() => {
    if (content === renderedContent) return;
    if (!content.startsWith(renderedContent)) {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
      setRenderedContent(content);
      return;
    }
    if (timerRef.current !== undefined) return;

    timerRef.current = window.setTimeout(() => {
      timerRef.current = undefined;
      setRenderedContent(latestContentRef.current);
    }, StreamingMarkdownRenderCadenceMs);
  }, [content, renderedContent]);

  useEffect(
    () => () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return renderedContent;
}
