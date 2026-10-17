import { useMemo, type CSSProperties, type SyntheticEvent } from "react";
import { cn } from "../../lib/util";
import { PierreFilePreview } from "./PierreCodeView";

interface CodeArtifactSourceViewProps {
  code: string;
  language: string;
  wrapped?: boolean;
  lineNumbers?: boolean;
  maxVisibleLines?: number;
  className?: string;
  contentClassName?: string;
}

export function CodeArtifactSourceView({
  code,
  language,
  wrapped = false,
  lineNumbers = true,
  maxVisibleLines,
  className,
  contentClassName,
}: CodeArtifactSourceViewProps): JSX.Element {
  const bounded = typeof maxVisibleLines === "number" && Number.isFinite(maxVisibleLines);
  const visibleLines = bounded ? Math.max(1, Math.floor(maxVisibleLines)) : undefined;
  const sourceStyle = useMemo<CSSProperties | undefined>(
    () =>
      visibleLines === undefined
        ? undefined
        : ({ "--code-source-max-height": `${visibleLines + 2}lh` } as CSSProperties),
    [visibleLines],
  );

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
      <div
        className={cn(
          "code-artifact-viewer__highlighted",
          wrapped && "is-wrapped",
          !lineNumbers && "without-line-numbers",
          contentClassName,
        )}
      >
        <PierreFilePreview
          code={code}
          fileName={`preview.${language}`}
          language={language}
          wrapped={wrapped}
          lineNumbers={lineNumbers}
          bounded={bounded}
          className={cn(wrapped && "is-wrapped", !lineNumbers && "without-line-numbers", contentClassName)}
        />
      </div>
    </div>
  );
}
