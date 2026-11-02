import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  getFiletypeFromFileName,
  getHighlighterIfLoaded,
  getHighlighterOptions,
  preloadHighlighter,
  type FileContents,
  type SupportedLanguages,
  type ThemesType,
} from "@pierre/diffs";
import { File as PierreFile, PatchDiff } from "@pierre/diffs/react";
import { LruCache } from "../../lib/LruCache";
import { cn } from "../../lib/util";
import type { ResolvedTheme } from "../theme/themeModel";
import { useAppearance } from "../theme/useAppearance";

const PIERRE_THEMES: ThemesType = {
  light: "github-light",
  dark: "github-dark-dimmed",
};

const pierreLanguagePreloads = new Map<string, Promise<void>>();
const pierrePreviewHtmlCache = new LruCache<string, Promise<string>>(20);
let pierreSsrRenderer: Promise<typeof import("@pierre/diffs/ssr")> | undefined;

interface PierreFilePreviewProps {
  readonly code: string;
  readonly fileName?: string;
  readonly language?: string;
  readonly wrapped?: boolean;
  readonly lineNumbers?: boolean;
  readonly bounded?: boolean;
  readonly className?: string;
  readonly prerenderedHTML?: string;
}

interface PierrePatchPreviewProps {
  readonly patch: string;
  readonly fileName?: string;
  readonly bounded?: boolean;
  readonly className?: string;
  readonly prerenderedHTML?: string;
}

/**
 * Builds the exact Shadow DOM payload used by Pierre before a transient
 * surface becomes visible. The cache coalesces hover requests and bounds the
 * retained highlighted markup rather than retaining rendered DOM nodes.
 */
export function preloadPierrePatchPreview({
  patch,
  theme,
}: {
  readonly patch: string;
  readonly theme: ResolvedTheme;
}): Promise<string> {
  return readPierrePreviewHtml(["patch", theme, patch], () =>
    loadPierreSsrRenderer().then(({ preloadPatchDiff }) =>
      preloadPatchDiff({ patch, options: createPierrePatchOptions(theme) }).then((result) => result.prerenderedHTML),
    ),
  );
}

export function preloadPierreFilePreview({
  code,
  fileName,
  language,
  lineNumbers,
  theme,
  wrapped,
}: {
  readonly code: string;
  readonly fileName?: string;
  readonly language?: string;
  readonly lineNumbers: boolean;
  readonly theme: ResolvedTheme;
  readonly wrapped: boolean;
}): Promise<string> {
  const file = createPierreFile(code, fileName, language);
  return readPierrePreviewHtml(["file", theme, wrapped, lineNumbers, file.name, file.lang ?? "", code], () =>
    loadPierreSsrRenderer().then(({ preloadFile }) =>
      preloadFile({ file, options: createPierreFileOptions(theme, wrapped, lineNumbers) }).then(
        (result) => result.prerenderedHTML,
      ),
    ),
  );
}

export function PierreFilePreview({
  code,
  fileName,
  language,
  wrapped = false,
  lineNumbers = true,
  bounded = false,
  className,
  prerenderedHTML,
}: PierreFilePreviewProps): JSX.Element {
  const { resolvedTheme } = useAppearance();
  const file = useMemo<FileContents>(() => createPierreFile(code, fileName, language), [code, fileName, language]);
  const highlightLanguage = useMemo<SupportedLanguages>(
    () => (file.lang ?? getFiletypeFromFileName(file.name)) as SupportedLanguages,
    [file.lang, file.name],
  );
  const languageKey = String(highlightLanguage);
  const [preloadedLanguage, setPreloadedLanguage] = useState<string>();

  // Pierre renders synchronously only once the shared highlighter holds both
  // the themes and the language. Mounting earlier makes the first render wait
  // on `asyncHighlight`, and React re-running effects (StrictMode) discards
  // that result, leaving the Shadow DOM permanently empty. Gate the mount on
  // the documented `preloadHighlighter` API instead of repairing the frame.
  const highlightReady =
    prerenderedHTML !== undefined ||
    preloadedLanguage === languageKey ||
    getHighlighterIfLoaded({ theme: PIERRE_THEMES, lang: highlightLanguage }) != null;

  useEffect(() => {
    if (prerenderedHTML !== undefined) return;
    if (getHighlighterIfLoaded({ theme: PIERRE_THEMES, lang: highlightLanguage }) != null) return;

    let cancelled = false;
    void readPierreLanguagePreload(highlightLanguage).then(
      () => {
        if (!cancelled) setPreloadedLanguage(languageKey);
      },
      () => undefined,
    );

    return () => {
      cancelled = true;
    };
  }, [highlightLanguage, languageKey, prerenderedHTML]);

  const options = useMemo(
    () => createPierreFileOptions(resolvedTheme, wrapped, lineNumbers),
    [lineNumbers, resolvedTheme, wrapped],
  );

  return (
    <div className={cn("senera-pierre-code-frame", bounded && "senera-pierre-code-frame--bounded")}>
      {highlightReady ? (
        <PierreFile
          file={file}
          options={options}
          className={cn("senera-pierre-code", className)}
          style={createPierreStyle()}
          prerenderedHTML={prerenderedHTML}
        />
      ) : (
        <CodeSourceFallback code={code} className={className} wrapped={wrapped} lineNumbers={lineNumbers} />
      )}
    </div>
  );
}

function readPierreLanguagePreload(language: SupportedLanguages): Promise<void> {
  const key = String(language);
  const existing = pierreLanguagePreloads.get(key);
  if (existing !== undefined) return existing;

  const preload = preloadHighlighter(getHighlighterOptions(language, { theme: PIERRE_THEMES }));
  pierreLanguagePreloads.set(key, preload);
  void preload.catch(() => {
    if (pierreLanguagePreloads.get(key) === preload) pierreLanguagePreloads.delete(key);
  });
  return preload;
}

function CodeSourceFallback({
  code,
  className,
  wrapped,
  lineNumbers,
}: {
  readonly code: string;
  readonly className?: string;
  readonly wrapped: boolean;
  readonly lineNumbers: boolean;
}): JSX.Element {
  return (
    <div
      className={cn(
        "code-artifact-viewer__highlighted senera-pierre-code__fallback",
        wrapped && "is-wrapped",
        !lineNumbers && "without-line-numbers",
        className,
      )}
    >
      <pre>
        <code>
          {code.split("\n").map((line, index) => (
            <div key={index} data-line={index + 1}>
              {line}
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}

export function PierrePatchPreview({
  patch,
  fileName,
  bounded = true,
  className,
  prerenderedHTML,
}: PierrePatchPreviewProps): JSX.Element {
  const { resolvedTheme } = useAppearance();
  const options = useMemo(() => createPierrePatchOptions(resolvedTheme), [resolvedTheme]);

  return (
    <div
      className={cn("senera-pierre-diff-frame", bounded && "senera-pierre-diff-frame--bounded", className)}
      data-resource-diff
      data-resource-diff-file={fileName}
    >
      <PatchDiff
        patch={patch}
        options={options}
        className="senera-pierre-diff"
        style={createPierrePatchStyle()}
        prerenderedHTML={prerenderedHTML}
      />
    </div>
  );
}

function createPierreFile(code: string, fileName?: string, language?: string): FileContents {
  const file: FileContents = {
    name: fileName ?? "preview.txt",
    contents: code,
  };
  if (language) file.lang = language as SupportedLanguages;
  return file;
}

function createPierreFileOptions(theme: ResolvedTheme, wrapped: boolean, lineNumbers: boolean) {
  return {
    theme: PIERRE_THEMES,
    themeType: theme,
    disableLineNumbers: !lineNumbers,
    disableFileHeader: true,
    overflow: wrapped ? "wrap" : "scroll",
  } as const;
}

function createPierrePatchOptions(theme: ResolvedTheme) {
  return {
    theme: PIERRE_THEMES,
    themeType: theme,
    disableFileHeader: true,
    overflow: "scroll",
    diffStyle: "unified",
    diffIndicators: "bars",
    hunkSeparators: "line-info",
    lineDiffType: "word-alt",
  } as const;
}

function readPierrePreviewHtml(keyParts: readonly unknown[], create: () => Promise<string>): Promise<string> {
  const key = JSON.stringify(keyParts);
  const existing = pierrePreviewHtmlCache.get(key);
  if (existing) return existing;

  const pending = create().catch((error: unknown) => {
    pierrePreviewHtmlCache.delete(key);
    throw error;
  });
  pierrePreviewHtmlCache.set(key, pending);
  return pending;
}

function loadPierreSsrRenderer(): Promise<typeof import("@pierre/diffs/ssr")> {
  if (pierreSsrRenderer) return pierreSsrRenderer;

  const loading = import("@pierre/diffs/ssr");
  pierreSsrRenderer = loading;
  void loading.catch(() => {
    if (pierreSsrRenderer === loading) pierreSsrRenderer = undefined;
  });
  return pierreSsrRenderer;
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

/**
 * Diff tokens are kept distinct from the file viewer: changes need a stable
 * semantic hue even when source syntax uses the same palette.
 */
function createPierrePatchStyle(): CSSProperties {
  return {
    ...createPierreStyle(),
    "--diffs-light-addition-color": "rgb(var(--color-moss-500))",
    "--diffs-dark-addition-color": "rgb(var(--color-moss-400))",
    "--diffs-light-deletion-color": "rgb(var(--color-brick-500))",
    "--diffs-dark-deletion-color": "rgb(var(--color-brick-600))",
  } as CSSProperties;
}
