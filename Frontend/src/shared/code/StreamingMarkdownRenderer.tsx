import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/util";
import { LazyMarkdownRenderer } from "./LazyMarkdownRenderer";
import type { MarkdownRendererProps } from "./MarkdownRenderer";

/**
 * Parsing every token can make a virtualized conversation remeasure constantly.
 * A short independent cadence keeps Markdown live while preserving scroll and
 * input responsiveness during long answers.
 */
export const StreamingMarkdownRenderCadenceMs = 64;

export function StreamingMarkdownRenderer({
  children,
  className,
  contentClassName,
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
      <LazyMarkdownRenderer
        className="min-w-0"
        contentClassName={contentClassName}
        compact={compact}
        lightweightCode
        externalLinkPresentation={externalLinkPresentation}
      >
        {renderedContent}
      </LazyMarkdownRenderer>
      <span className="caret-blink" aria-hidden="true" />
    </div>
  );
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
