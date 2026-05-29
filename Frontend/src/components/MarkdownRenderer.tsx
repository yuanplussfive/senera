import {
  Children,
  isValidElement,
  useState,
  type AnchorHTMLAttributes,
  type CSSProperties,
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type TableHTMLAttributes,
} from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  Maximize2,
} from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { cn } from "../lib/util";
import { readCodeArtifact, type CodeArtifact } from "./CodeArtifactModel";
import { CodeArtifactSourceView } from "./CodeArtifactSourceView";
import { CodeArtifactViewer } from "./CodeArtifactViewer";
import { Tooltip } from "./ui/Tooltip";

const DEFAULT_CODE_PREVIEW_LINES = 10;

interface MarkdownRendererProps {
  children: string;
  className?: string;
  contentClassName?: string;
  compact?: boolean;
  lightweightCode?: boolean;
}

interface AnchorProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href?: string;
}

export function MarkdownRenderer({
  children,
  className,
  contentClassName,
  compact = false,
  lightweightCode = false,
}: MarkdownRendererProps): JSX.Element {
  const rendererClassName = cn(
    "markdown-renderer",
    compact && "markdown-renderer--compact",
    contentClassName,
  );

  return (
    <div className={className}>
      <Markdown
        className={rendererClassName}
        remarkPlugins={[remarkGfm]}
        components={{
          a: MarkdownLink,
          pre: lightweightCode
            ? LightweightCodeBlock
            : CodeBlock,
          table: MarkdownTable,
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}

function LightweightCodeBlock({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"pre">): JSX.Element {
  const code = findChildByTag(children, "code");
  const language = code ? readCodeLanguage(code) : "text";
  const codeText = readNodeText(code?.props.children ?? children).replace(/\n$/, "");
  const lines = codeText ? codeText.split("\n").length : 0;

  return (
    <pre className={cn("markdown-renderer__code-block", className)} {...props}>
      <div className="markdown-renderer__code-toolbar">
        <span className="markdown-renderer__code-language">{language}</span>
        <span className="markdown-renderer__code-lines">{lines} lines</span>
      </div>
      <code data-language={language}>{codeText}</code>
    </pre>
  );
}

function MarkdownLink({ href, children, className, ...props }: AnchorProps): JSX.Element {
  const external = typeof href === "string" && /^https?:\/\//i.test(href);

  return (
    <a
      href={href}
      className={cn("markdown-renderer__link", className)}
      target={external ? "_blank" : props.target}
      rel={external ? "noreferrer noopener" : props.rel}
      {...props}
    >
      <span>{children}</span>
      {external ? <ExternalLink className="h-3.5 w-3.5 shrink-0" /> : null}
    </a>
  );
}

function MarkdownTable({ children, className, ...props }: TableHTMLAttributes<HTMLTableElement>): JSX.Element {
  return (
    <div className="markdown-renderer__table-wrap scrollbar-thin">
      <table className={cn("markdown-renderer__table", className)} {...props}>
        {children}
      </table>
    </div>
  );
}

function CodeBlock({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"pre">): JSX.Element {
  const code = findChildByTag(children, "code");
  const language = code ? readCodeLanguage(code) : "text";
  const codeText = readNodeText(code?.props.children ?? children).replace(/\n$/, "");
  const artifact = readCodeArtifact(language, codeText);
  return <PreviewCodeBlock artifact={artifact} className={className} {...props} />;
}

function PreviewCodeBlock({
  artifact,
  className,
  ...props
}: ComponentPropsWithoutRef<"pre"> & {
  artifact: CodeArtifact;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerInitialView, setViewerInitialView] = useState<"source" | "preview">("source");

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(artifact.code);
      setCopied(true);
      toast.success("代码已复制");
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("复制失败");
    }
  };

  const openArtifactViewer = (view: "source" | "preview"): void => {
    setViewerInitialView(view);
    setViewerOpen(true);
  };

  return (
    <figure className={cn("markdown-renderer__code-block markdown-renderer__code-block--artifact", className)} {...props}>
      <figcaption className="markdown-renderer__code-header">
        <CodeBlockHeader
          language={artifact.language}
          lineCount={artifact.lineCount}
          copied={copied}
          preview={artifact.preview}
          onOpenViewer={() => openArtifactViewer("source")}
          onPreview={() => openArtifactViewer("preview")}
          onCopy={onCopy}
        />
      </figcaption>
      <CodeArtifactSourceView
        code={artifact.code}
        language={artifact.language}
        maxVisibleLines={DEFAULT_CODE_PREVIEW_LINES}
        className="markdown-renderer__artifact-source"
      />
      <button
        type="button"
        role="button"
        className="markdown-renderer__artifact-card"
        onClick={() => openArtifactViewer(artifact.preview ? "preview" : "source")}
      >
        <div className="markdown-renderer__artifact-summary">
          <span>{artifact.filename}</span>
          <span>{artifact.lineCount} lines</span>
        </div>
      </button>
      <CodeArtifactViewer
        artifact={artifact}
        open={viewerOpen}
        initialView={viewerInitialView}
        onOpenChange={setViewerOpen}
      />
    </figure>
  );
}

function CodeBlockHeader({
  language,
  lineCount,
  copied,
  preview,
  onOpenViewer,
  onPreview,
  onCopy,
}: {
  language: string;
  lineCount: number;
  copied: boolean;
  preview: CodeArtifact["preview"];
  onOpenViewer?: () => void;
  onPreview?: () => void;
  onCopy: () => void;
}): JSX.Element {
  const countLabel = `${lineCount} lines`;
  const stopButtonEvent = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
  };

  return (
    <div className="markdown-renderer__code-toolbar">
      <span className="markdown-renderer__code-language">{language}</span>
      <div className="markdown-renderer__code-actions">
        <span
          className="markdown-renderer__code-lines"
          aria-label="line-count"
          style={{ "--code-lines-width": `${countLabel.length}ch` } as CSSProperties}
        >
          {countLabel}
        </span>
        {preview && onPreview ? (
          <Tooltip content={preview.label} side="top">
            <button
              type="button"
              onClick={(event) => {
                stopButtonEvent(event);
                onPreview();
              }}
              onPointerDown={stopButtonEvent}
              className="markdown-renderer__code-iconbtn"
              aria-label={preview.label}
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        ) : null}
        {onOpenViewer ? (
          <Tooltip content="查看源码" side="top">
            <button
              type="button"
              onClick={(event) => {
                stopButtonEvent(event);
                onOpenViewer();
              }}
              onPointerDown={stopButtonEvent}
              className="markdown-renderer__code-iconbtn"
              aria-label="打开代码查看器"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        ) : null}
        <Tooltip content={copied ? "已复制" : "复制"} side="top">
          <button
            type="button"
            onClick={(event) => {
              stopButtonEvent(event);
              void onCopy();
            }}
            onPointerDown={stopButtonEvent}
            className="markdown-renderer__code-iconbtn"
            aria-label={`复制 ${language} 代码`}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-moss-500" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

type ElementWithChildren = ReactElement<{ children?: ReactNode }>;
type ElementWithProps = ReactElement<Record<string, unknown>>;

function findChildByTag(node: ReactNode, tagName: string): ElementWithChildren | null {
  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) continue;
    const element = child as ElementWithChildren;
    if (typeof child.type === "string" && child.type === tagName) {
      return element;
    }

    const nested = findChildByTag(element.props.children, tagName);
    if (nested) return nested;
  }

  return null;
}

function readCodeLanguage(code: ElementWithProps): string {
  const direct = readDataLanguage(code.props);
  if (direct) return direct;

  const className = code.props.className;
  if (typeof className !== "string") return "text";

  const language = className
    .split(/\s+/)
    .find((part) => part.startsWith("language-"))
    ?.slice("language-".length);
  return language && language.trim() ? language.trim() : "text";
}

function readDataLanguage(props: Record<string, unknown>): string | null {
  const language = props["data-language"];
  return typeof language === "string" && language.trim() ? language.trim() : null;
}

function readNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map((child) => readNodeText(child)).join("");
  }

  if (isValidElement(node)) {
    return readNodeText((node as ElementWithChildren).props.children);
  }

  return "";
}
