import { LazyMarkdownRenderer } from "../../shared/code/LazyMarkdownRenderer";
import { StreamingMarkdownRenderer } from "../../shared/code/StreamingMarkdownRenderer";

export interface ChatMessageMarkdownProps {
  content: string;
  streaming?: boolean;
  className?: string;
  contentClassName?: string;
  externalLinkPresentation?: "text" | "citation";
}

/**
 * Keep final and streaming chat content on one Markdown contract. The caller
 * only chooses the surrounding typography; parsing, links, media, and code
 * blocks stay identical for every message role.
 */
export function ChatMessageMarkdown({
  content,
  streaming = false,
  className,
  contentClassName,
  externalLinkPresentation = "text",
}: ChatMessageMarkdownProps): JSX.Element {
  const rendererProps = {
    className,
    contentClassName,
    externalLinkPresentation,
  } as const;

  return streaming ? (
    <StreamingMarkdownRenderer {...rendererProps}>{content}</StreamingMarkdownRenderer>
  ) : (
    <LazyMarkdownRenderer {...rendererProps}>{content}</LazyMarkdownRenderer>
  );
}
