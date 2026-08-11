import {
  Children,
  isValidElement,
  lazy,
  Suspense,
  useState,
  type AnchorHTMLAttributes,
  type CSSProperties,
  type ComponentPropsWithoutRef,
  type ImgHTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type TableHTMLAttributes,
} from "react";
import { Check, Copy, ExternalLink, Maximize2 } from "lucide-react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { MotionIconSwap } from "../motion";
import { Spinner, Tooltip, useClipboardCopy } from "../ui";
import { CollapsibleCodeBlock } from "./CollapsibleCodeBlock";
import { type CodeArtifact, readCodeArtifact } from "./CodeArtifactModel";
import { parseWorkspaceResourceLocator } from "../workspace/WorkspaceResourceLocator";
import { WorkspaceMarkdownImage } from "../workspace/WorkspaceMarkdownImage";
import { useWorkspaceResourceController } from "../workspace/WorkspaceResourceProvider";
import "../../styles/markdown.css";

const DEFAULT_CODE_PREVIEW_LINES = 10;
const LazyCodeArtifactViewer = lazy(() =>
  import("./CodeArtifactViewer").then((module) => ({
    default: module.CodeArtifactViewer,
  })),
);

export interface MarkdownRendererProps {
  children: string;
  className?: string;
  contentClassName?: string;
  compact?: boolean;
  lightweightCode?: boolean;
}

interface AnchorProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href?: string;
  node?: unknown;
}

export function MarkdownRenderer({
  children,
  className,
  contentClassName,
  compact = false,
  lightweightCode = false,
}: MarkdownRendererProps): JSX.Element {
  const rendererClassName = cn("markdown-renderer", compact && "markdown-renderer--compact", contentClassName);

  return (
    <div className={className}>
      <Markdown
        className={rendererClassName}
        remarkPlugins={[remarkGfm]}
        urlTransform={transformMarkdownUrl}
        components={{
          a: MarkdownLink,
          img: MarkdownImage,
          pre: lightweightCode ? LightweightCodeBlock : CodeBlock,
          table: MarkdownTable,
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}

function LightweightCodeBlock({ children, className, ...props }: ComponentPropsWithoutRef<"pre">): JSX.Element {
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

function MarkdownLink({ href, children, className, node: _node, ...props }: AnchorProps): JSX.Element {
  const external = typeof href === "string" && /^https?:\/\//i.test(href);
  const resource = parseWorkspaceResourceLocator(href);
  const resourceController = useWorkspaceResourceController();

  if (resource) {
    const openResource = (event: MouseEvent<HTMLAnchorElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      resourceController?.openResource(resource);
    };
    return (
      <a
        {...props}
        href={href}
        className={cn("markdown-renderer__link markdown-renderer__link--resource", className)}
        data-workspace-resource={resource.path}
        onClick={openResource}
        onAuxClick={openResource}
      >
        <span>{children}</span>
      </a>
    );
  }

  return (
    <a
      {...props}
      href={href}
      className={cn("markdown-renderer__link", className)}
      target={external ? "_blank" : props.target}
      rel={external ? "noreferrer noopener" : props.rel}
    >
      <span>{children}</span>
      {external ? <ExternalLink className="h-3.5 w-3.5 shrink-0" /> : null}
    </a>
  );
}

function MarkdownImage({
  src,
  alt,
  className,
  node: _node,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & { node?: unknown }): JSX.Element {
  const resource = parseWorkspaceResourceLocator(src);
  if (resource) {
    return <WorkspaceMarkdownImage {...props} locator={resource} alt={alt} className={className} />;
  }
  return <img {...props} src={src} alt={alt ?? ""} className={cn("max-w-full", className)} loading="lazy" />;
}

function transformMarkdownUrl(value: string): string {
  return parseWorkspaceResourceLocator(value) ? value : defaultUrlTransform(value);
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

function CodeBlock({ children, className, ...props }: ComponentPropsWithoutRef<"pre">): JSX.Element {
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
  const { copied, copyText } = useClipboardCopy({ successMessage: frontendMessage("code.copied") });
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerInitialView, setViewerInitialView] = useState<"source" | "preview">("source");

  const onCopy = async (): Promise<void> => {
    await copyText(artifact.code);
  };

  const openArtifactViewer = (view: "source" | "preview"): void => {
    setViewerInitialView(view);
    setViewerOpen(true);
  };

  return (
    <figure
      className={cn("markdown-renderer__code-block markdown-renderer__code-block--artifact", className)}
      {...props}
    >
      <figcaption className="markdown-renderer__code-header">
        <CodeBlockHeader
          language={artifact.language}
          lineCount={artifact.lineCount}
          copied={copied}
          onOpenViewer={() => openArtifactViewer(artifact.preview ? "preview" : "source")}
          onCopy={onCopy}
        />
      </figcaption>
      <CollapsibleCodeBlock
        code={artifact.code}
        language={artifact.language}
        lineCount={artifact.lineCount}
        previewLines={DEFAULT_CODE_PREVIEW_LINES}
        className="markdown-renderer__artifact-source"
      />
      {viewerOpen ? (
        <Suspense fallback={<CodeArtifactViewerLoading />}>
          <LazyCodeArtifactViewer
            artifact={artifact}
            open={viewerOpen}
            initialView={viewerInitialView}
            onOpenChange={setViewerOpen}
          />
        </Suspense>
      ) : null}
    </figure>
  );
}

function CodeArtifactViewerLoading(): JSX.Element {
  return (
    <div className="code-artifact-viewer__loading" role="status" aria-busy="true">
      <Spinner size="sm" className="text-ink-500" />
      <span className="text-[12px] text-ink-600">{frontendMessage("ui.loading")}</span>
    </div>
  );
}

function CodeBlockHeader({
  language,
  lineCount,
  copied,
  onOpenViewer,
  onCopy,
}: {
  language: string;
  lineCount: number;
  copied: boolean;
  onOpenViewer?: () => void;
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
        {onOpenViewer ? (
          <Tooltip content={frontendMessage("code.viewSource")} side="top">
            <button
              type="button"
              onClick={(event) => {
                stopButtonEvent(event);
                onOpenViewer();
              }}
              onPointerDown={stopButtonEvent}
              className="markdown-renderer__code-iconbtn"
              aria-label={frontendMessage("code.openViewer")}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        ) : null}
        <Tooltip content={frontendMessage(copied ? "clipboard.copied" : "clipboard.copyToast")} side="top">
          <button
            type="button"
            onClick={(event) => {
              stopButtonEvent(event);
              void onCopy();
            }}
            onPointerDown={stopButtonEvent}
            className="markdown-renderer__code-iconbtn"
            aria-label={frontendMessage("code.copyLanguage", { language })}
          >
            <MotionIconSwap stateKey={copied ? "copied" : "copy"}>
              {copied ? <Check className="h-3.5 w-3.5 text-moss-500" /> : <Copy className="h-3.5 w-3.5" />}
            </MotionIconSwap>
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
