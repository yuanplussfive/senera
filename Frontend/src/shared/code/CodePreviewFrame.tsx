import { useMemo } from "react";
import { cn } from "../../lib/util";
import { useAppearance } from "../theme/useAppearance";
import { applyCodePreviewTheme, createCodePreviewThemeVariables, type CodePreview } from "./CodePreviewRegistry";

export function CodePreviewFrame({
  preview,
  title,
  className,
}: {
  readonly preview: CodePreview;
  readonly title: string;
  readonly className?: string;
}): JSX.Element {
  const { tokens } = useAppearance();
  const source = useMemo(
    () => applyCodePreviewTheme(preview.source, createCodePreviewThemeVariables(tokens.cssVariables)),
    [preview.source, tokens.cssVariables],
  );

  return (
    <iframe
      className={cn("h-full min-h-0 w-full flex-1 border-0", className)}
      style={{ backgroundColor: "var(--theme-code-preview-bg, white)" }}
      title={title}
      sandbox={preview.sandbox}
      srcDoc={source}
    />
  );
}
