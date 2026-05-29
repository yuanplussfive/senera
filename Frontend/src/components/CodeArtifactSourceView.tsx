import { useEffect, useMemo, useState, type CSSProperties, type SyntheticEvent } from "react";
import { cn } from "../lib/util";
import {
  highlightCode,
  loadingHighlightedCode,
  readHighlightedCode,
  type HighlightedCodeState,
} from "./CodeHighlighter";

interface CodeArtifactSourceViewProps {
  code: string;
  language: string;
  wrapped?: boolean;
  maxVisibleLines?: number;
  className?: string;
  contentClassName?: string;
}

export function CodeArtifactSourceView({
  code,
  language,
  wrapped = false,
  maxVisibleLines,
  className,
  contentClassName,
}: CodeArtifactSourceViewProps): JSX.Element {
  const [highlightedSource, setHighlightedSource] = useState<HighlightedCodeState>(() => loadingHighlightedCode());
  const bounded = typeof maxVisibleLines === "number" && Number.isFinite(maxVisibleLines);
  const visibleLines = bounded ? Math.max(1, Math.floor(maxVisibleLines)) : undefined;
  const sourceStyle = useMemo<CSSProperties | undefined>(
    () => visibleLines === undefined
      ? undefined
      : { "--code-source-max-height": `${visibleLines + 2}lh` } as CSSProperties,
    [visibleLines],
  );

  useEffect(() => {
    let cancelled = false;
    const request = { code, language };
    const highlighted = readHighlightedCode(request) ?? highlightCode(request);
    setHighlightedSource(loadingHighlightedCode());

    highlighted
      .then((html) => {
        if (!cancelled) setHighlightedSource({ status: "ready", html });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setHighlightedSource({ status: "failed", reason });
      });

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  const stopNestedScroll = (event: SyntheticEvent<HTMLDivElement>): void => {
    if (bounded) event.stopPropagation();
  };

  return (
    <div
      className={cn(
        "code-artifact-viewer__source scrollbar-thin",
        bounded && "code-artifact-viewer__source--bounded",
        className,
      )}
      style={sourceStyle}
      tabIndex={bounded ? 0 : undefined}
      onWheel={stopNestedScroll}
      onTouchMove={stopNestedScroll}
    >
      <div className={cn("code-artifact-viewer__highlighted", wrapped && "is-wrapped", contentClassName)}>
        <HighlightedCodeView
          state={highlightedSource}
          code={code}
          language={language}
        />
      </div>
    </div>
  );
}

function HighlightedCodeView({
  state,
  code,
  language,
}: {
  state: HighlightedCodeState;
  code: string;
  language: string;
}): JSX.Element {
  if (state.status === "ready") {
    return <div dangerouslySetInnerHTML={{ __html: state.html }} />;
  }

  return (
    <PlainSourceView
      code={code}
      language={language}
      status={state.status}
    />
  );
}

function PlainSourceView({
  code,
  language,
  status,
}: {
  code: string;
  language: string;
  status: Exclude<HighlightedCodeState["status"], "ready">;
}): JSX.Element {
  return (
    <pre
      className="code-artifact-viewer__plain"
      data-highlight-status={status}
    >
      <code data-language={language}>
        {readCodeLines(code).map((line, index) => (
          <span data-line="" key={index}>
            {line}
          </span>
        ))}
      </code>
    </pre>
  );
}

function readCodeLines(code: string): string[] {
  if (!code) return [""];
  return code.split("\n");
}
