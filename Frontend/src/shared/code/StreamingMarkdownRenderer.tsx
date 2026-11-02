import { memo, useMemo, useState, type CSSProperties } from "react";
import { cn } from "../../lib/util";
import type { MarkdownRendererProps } from "./MarkdownRenderer";
import { isPlainTextMarkdown, LazyMarkdownRenderer } from "./LazyMarkdownRenderer";

interface StreamingMarkdownSegments {
  source: string;
  prefix: string;
  tail: string;
}

interface StreamingMarkdownSegmentProps {
  content: string;
  contentClassName?: string;
  contentStyle?: CSSProperties;
  compact?: boolean;
  externalLinkPresentation?: "text" | "citation";
}

type StreamingMarkdownSharedProps = Omit<StreamingMarkdownSegmentProps, "content">;

export function StreamingMarkdownRenderer({
  children,
  className,
  contentClassName,
  contentStyle,
  compact,
  externalLinkPresentation,
  showCaret = true,
}: Omit<MarkdownRendererProps, "lightweightCode"> & { showCaret?: boolean }): JSX.Element {
  const segments = useStreamingMarkdownSegments(children);
  const sharedProps = useMemo<StreamingMarkdownSharedProps>(
    () => ({ contentClassName, contentStyle, compact, externalLinkPresentation }),
    [compact, contentClassName, contentStyle, externalLinkPresentation],
  );

  return (
    <div
      className={cn("streaming-markdown min-w-0", compact && "streaming-markdown--compact", className)}
      data-assistant-streaming-body
      data-streaming-markdown-renderer
    >
      {segments.prefix ? (
        <div data-streaming-markdown-prefix>
          <StreamingMarkdownSegment content={segments.prefix} {...sharedProps} />
        </div>
      ) : null}
      {segments.tail ? (
        <StreamingMarkdownTail content={segments.tail} showCaret={showCaret} {...sharedProps} />
      ) : showCaret ? (
        <span className="caret-blink" aria-hidden="true" />
      ) : null}
    </div>
  );
}

const StreamingMarkdownSegment = memo(function StreamingMarkdownSegment({
  content,
  contentClassName,
  contentStyle,
  compact,
  externalLinkPresentation,
}: StreamingMarkdownSegmentProps): JSX.Element {
  return (
    <LazyMarkdownRenderer
      className="min-w-0"
      contentClassName={contentClassName}
      contentStyle={contentStyle}
      compact={compact}
      lightweightCode
      externalLinkPresentation={externalLinkPresentation}
    >
      {content}
    </LazyMarkdownRenderer>
  );
});

function StreamingMarkdownTail({
  content,
  showCaret,
  contentClassName,
  contentStyle,
  compact,
  externalLinkPresentation,
}: StreamingMarkdownSegmentProps & {
  showCaret: boolean;
}): JSX.Element {
  const plainText = isPlainTextMarkdown(content);

  return (
    <div
      className="streaming-markdown__tail min-w-0"
      data-streaming-markdown-tail
      aria-live="polite"
      aria-atomic="false"
    >
      {plainText ? (
        <p
          className={cn(
            "markdown-renderer whitespace-pre-wrap break-words",
            compact && "markdown-renderer--compact",
            compact && "text-[13px]",
            contentClassName,
          )}
          style={contentStyle}
        >
          <span data-streaming-markdown-live-text>{content}</span>
          {showCaret ? <span className="caret-blink" aria-hidden="true" /> : null}
        </p>
      ) : (
        <>
          <StreamingMarkdownSegment
            content={content}
            contentClassName={contentClassName}
            contentStyle={contentStyle}
            compact={compact}
            externalLinkPresentation={externalLinkPresentation}
          />
          {showCaret ? <span className="caret-blink" aria-hidden="true" /> : null}
        </>
      )}
    </div>
  );
}

function useStreamingMarkdownSegments(content: string): StreamingMarkdownSegments {
  const [segments, setSegments] = useState<StreamingMarkdownSegments>(() => createStreamingMarkdownSegments(content));
  // The socket already batches deltas per frame. Derive the live tail before
  // this commit instead of scheduling another effect, frame and paint.
  if (content !== segments.source) {
    const next = createStreamingMarkdownSegments(content, segments);
    setSegments(next);
    return next;
  }
  return segments;
}

function createStreamingMarkdownSegments(
  source: string,
  previous?: StreamingMarkdownSegments,
): StreamingMarkdownSegments {
  const continuing = previous !== undefined && source.startsWith(previous.source);
  const activeSource = continuing ? source.slice(previous.prefix.length) : source;
  const boundary = findStableMarkdownBoundary(activeSource);
  const prefix = continuing ? previous.prefix + activeSource.slice(0, boundary) : source.slice(0, boundary);
  const tail = activeSource.slice(boundary);

  return {
    source,
    prefix,
    tail,
  };
}

/**
 * Separate only completed Markdown blocks. The active block remains in the
 * live tail because later deltas may still alter its syntax or structure.
 */
function findStableMarkdownBoundary(source: string): number {
  let boundary = 0;
  let fence: MarkdownFence | undefined;
  let previousNonBlankKind: "list" | "quote" | "other" = "other";
  let blankRunEnd: number | undefined;

  for (const line of iterateMarkdownLines(source)) {
    if (fence) {
      if (line.terminated && isClosingFence(line.text, fence)) {
        fence = undefined;
        boundary = line.end;
      }
      continue;
    }

    const openingFence = readOpeningFence(line.text);
    if (openingFence) {
      fence = openingFence;
      blankRunEnd = undefined;
      continue;
    }

    if (isBlankMarkdownLine(line.text)) {
      blankRunEnd = line.end;
      continue;
    }

    if (blankRunEnd !== undefined && isSafeBlockContinuation(line.text, previousNonBlankKind)) {
      boundary = blankRunEnd;
    }
    blankRunEnd = undefined;

    if (line.terminated && isStandaloneMarkdownBlock(line.text)) {
      boundary = line.end;
    }
    previousNonBlankKind = readMarkdownLineKind(line.text);
  }

  return boundary;
}

interface MarkdownLine {
  text: string;
  end: number;
  terminated: boolean;
}

interface MarkdownFence {
  character: "`" | "~";
  length: number;
}

function* iterateMarkdownLines(source: string): Generator<MarkdownLine> {
  let start = 0;
  while (start < source.length) {
    const newline = source.indexOf("\n", start);
    const end = newline === -1 ? source.length : newline + 1;
    const textEnd = newline === -1 ? source.length : newline;
    const text = source.slice(start, textEnd).replace(/\r$/u, "");
    yield { text, end, terminated: newline !== -1 };
    start = end;
  }
}

function readOpeningFence(line: string): MarkdownFence | undefined {
  const match = /^(?: {0,3})(`{3,}|~{3,})/u.exec(line);
  if (!match) return undefined;
  const marker = match[1];
  return { character: marker[0] as MarkdownFence["character"], length: marker.length };
}

function isClosingFence(line: string, fence: MarkdownFence): boolean {
  const expression = new RegExp(`^(?: {0,3})${fence.character}{${fence.length},}[ \\t]*$`, "u");
  return expression.test(line);
}

function isBlankMarkdownLine(line: string): boolean {
  return /^[ \\t]*$/u.test(line);
}

function isSafeBlockContinuation(line: string, previousKind: "list" | "quote" | "other"): boolean {
  if (/^(?: {4}|\t)/u.test(line)) return false;
  if (previousKind === "list") return isUnambiguouslyIndependentBlock(line);
  if (previousKind === "quote" && isMarkdownQuoteLine(line)) return false;
  return true;
}

function isUnambiguouslyIndependentBlock(line: string): boolean {
  return isStandaloneMarkdownBlock(line) || readOpeningFence(line) !== undefined;
}

function isStandaloneMarkdownBlock(line: string): boolean {
  return /^(?: {0,3})(?:#{1,6}(?:[ \t]|$)|(?:[-*_][ \t]*){3,}$)/u.test(line);
}

function readMarkdownLineKind(line: string): "list" | "quote" | "other" {
  if (isMarkdownListLine(line)) return "list";
  return isMarkdownQuoteLine(line) ? "quote" : "other";
}

function isMarkdownListLine(line: string): boolean {
  return /^(?: {0,3})(?:[-+*]|(?:0|[1-9]\d{0,8})[.)])[ \t]+/u.test(line);
}

function isMarkdownQuoteLine(line: string): boolean {
  return /^(?: {0,3})>/u.test(line);
}
