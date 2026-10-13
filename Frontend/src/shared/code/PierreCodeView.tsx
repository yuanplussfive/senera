import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  getFiletypeFromFileName,
  getHighlighterOptions,
  preloadHighlighter,
  type FileContents,
  type SupportedLanguages,
  type ThemesType,
} from "@pierre/diffs";
import { File as PierreFile, PatchDiff } from "@pierre/diffs/react";
import { cn } from "../../lib/util";
import { useAppearance } from "../theme/useAppearance";

const PIERRE_THEMES: ThemesType = {
  light: "github-light",
  dark: "github-dark-dimmed",
};

const pierreLanguagePreloads = new Map<string, Promise<void>>();

interface PierreFilePreviewProps {
  readonly code: string;
  readonly fileName?: string;
  readonly language?: string;
  readonly wrapped?: boolean;
  readonly lineNumbers?: boolean;
  readonly bounded?: boolean;
  readonly className?: string;
}

interface PierrePatchPreviewProps {
  readonly patch: string;
  readonly fileName?: string;
  readonly bounded?: boolean;
  readonly className?: string;
}

export function PierreFilePreview({
  code,
  fileName,
  language,
  wrapped = false,
  lineNumbers = true,
  bounded = false,
  className,
}: PierreFilePreviewProps): JSX.Element {
  const { resolvedTheme } = useAppearance();
  const file = useMemo<FileContents>(() => {
    const nextFile: FileContents = {
      name: fileName ?? "preview.txt",
      contents: code,
    };
    if (language) nextFile.lang = language as SupportedLanguages;
    return nextFile;
  }, [code, fileName, language]);
  const highlightLanguage = useMemo<SupportedLanguages>(
    () => (file.lang ?? getFiletypeFromFileName(file.name)) as SupportedLanguages,
    [file.lang, file.name],
  );
  const [highlightReady, setHighlightReady] = useState(false);

  useEffect(() => {
    const key = String(highlightLanguage);
    let preload = pierreLanguagePreloads.get(key);
    if (preload === undefined) {
      preload = preloadHighlighter(getHighlighterOptions(highlightLanguage, { theme: PIERRE_THEMES }));
      pierreLanguagePreloads.set(key, preload);
    }

    let disposed = false;
    setHighlightReady(false);
    void preload.then(
      () => {
        if (!disposed) setHighlightReady(true);
      },
      () => undefined,
    );
    return () => {
      disposed = true;
    };
  }, [highlightLanguage]);
  const options = useMemo(
    () =>
      ({
        theme: PIERRE_THEMES,
        themeType: resolvedTheme,
        disableLineNumbers: !lineNumbers,
        disableFileHeader: true,
        overflow: wrapped ? "wrap" : "scroll",
      }) as const,
    [lineNumbers, resolvedTheme, wrapped],
  );

  return (
    <div className={cn("senera-pierre-code-frame", bounded && "senera-pierre-code-frame--bounded")}>
      <PierreFile
        key={`${highlightLanguage}:${highlightReady ? "ready" : "pending"}`}
        file={file}
        options={options}
        className={cn("senera-pierre-code", className)}
        style={createPierreStyle()}
      />
    </div>
  );
}

export function PierrePatchPreview({
  patch,
  fileName,
  bounded = true,
  className,
}: PierrePatchPreviewProps): JSX.Element {
  const { resolvedTheme } = useAppearance();
  const options = useMemo(
    () =>
      ({
        theme: PIERRE_THEMES,
        themeType: resolvedTheme,
        disableFileHeader: true,
        overflow: "scroll",
        diffStyle: "unified",
        diffIndicators: "bars",
        hunkSeparators: "line-info",
        lineDiffType: "word-alt",
      }) as const,
    [resolvedTheme],
  );

  return (
    <div
      className={cn("senera-pierre-diff-frame", bounded && "senera-pierre-diff-frame--bounded", className)}
      data-resource-diff
      data-resource-diff-file={fileName}
    >
      <PatchDiff patch={patch} options={options} className="senera-pierre-diff" style={createPierreStyle()} />
    </div>
  );
}

function createPierreStyle(): CSSProperties {
  return {
    "--diffs-font-family": "var(--theme-ui-font-family)",
    "--diffs-header-font-family": "var(--theme-ui-font-family)",
    "--diffs-font-size": "calc(var(--theme-tool-font-size) * 0.88)",
    "--diffs-line-height": "var(--theme-tool-line-height)",
    "--diffs-light-bg": "transparent",
    "--diffs-dark-bg": "transparent",
    "--diffs-light": "var(--content-primary)",
    "--diffs-dark": "var(--content-primary)",
  } as CSSProperties;
}
