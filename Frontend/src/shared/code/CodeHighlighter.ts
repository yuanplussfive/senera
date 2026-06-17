import { LruCache } from "../../lib/LruCache";
import { normalizeLanguage } from "./CodePreviewRegistry";
import type { ShikiTransformer } from "shiki";

export interface HighlightedCodeRequest {
  code: string;
  language: string;
}

export type HighlightedCodeState =
  | { status: "loading" }
  | { status: "ready"; html: string }
  | { status: "failed"; reason: unknown };

const CODE_HIGHLIGHT_THEME = "github-light";
const codeHighlightCache = new LruCache<string, Promise<string>>(80);
const HIGHLIGHT_LANGUAGE_LOADERS = {
  c: () => import("@shikijs/langs/c"),
  csharp: () => import("@shikijs/langs/csharp"),
  css: () => import("@shikijs/langs/css"),
  diff: () => import("@shikijs/langs/diff"),
  docker: () => import("@shikijs/langs/docker"),
  go: () => import("@shikijs/langs/go"),
  html: () => import("@shikijs/langs/html"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  jsx: () => import("@shikijs/langs/jsx"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  markdown: () => import("@shikijs/langs/markdown"),
  php: () => import("@shikijs/langs/php"),
  powershell: () => import("@shikijs/langs/powershell"),
  python: () => import("@shikijs/langs/python"),
  rust: () => import("@shikijs/langs/rust"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  sql: () => import("@shikijs/langs/sql"),
  swift: () => import("@shikijs/langs/swift"),
  toml: () => import("@shikijs/langs/toml"),
  tsx: () => import("@shikijs/langs/tsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  xml: () => import("@shikijs/langs/xml"),
  yaml: () => import("@shikijs/langs/yaml"),
} as const;
const HIGHLIGHT_LANGUAGE_ALIASES: Record<string, SupportedHighlightLanguage> = {
  bash: "shellscript",
  "c++": "c",
  cc: "c",
  cjs: "javascript",
  cs: "csharp",
  cts: "typescript",
  dockerfile: "docker",
  golang: "go",
  htm: "html",
  js: "javascript",
  kt: "kotlin",
  md: "markdown",
  mjs: "javascript",
  mts: "typescript",
  ps: "powershell",
  ps1: "powershell",
  py: "python",
  rb: "shellscript",
  ruby: "shellscript",
  rs: "rust",
  sh: "shellscript",
  shell: "shellscript",
  svg: "xml",
  ts: "typescript",
  xsl: "xml",
  yml: "yaml",
  zsh: "shellscript",
};
const HIGHLIGHT_THEMES = {
  [CODE_HIGHLIGHT_THEME]: () => import("@shikijs/themes/github-light"),
} as const;

type SupportedHighlightLanguage = keyof typeof HIGHLIGHT_LANGUAGE_LOADERS;
type HighlightRuntime = Awaited<ReturnType<typeof createHighlightRuntime>>;

let highlightRuntime: Promise<HighlightRuntime> | undefined;

export function readHighlightedCode(request: HighlightedCodeRequest): Promise<string> | undefined {
  return codeHighlightCache.get(readHighlightCacheKey(request));
}

export function highlightCode(request: HighlightedCodeRequest): Promise<string> {
  const cacheKey = readHighlightCacheKey(request);
  const cached = codeHighlightCache.get(cacheKey);
  if (cached) return cached;

  const highlighted = highlightCodeWithRuntime(request).catch((error: unknown) => {
    codeHighlightCache.delete(cacheKey);
    throw error;
  });

  codeHighlightCache.set(cacheKey, highlighted);
  return highlighted;
}

export function preloadHighlightedCode(request: HighlightedCodeRequest): void {
  if (!request.code || !resolveSupportedHighlightLanguage(request.language)) return;
  void highlightCode(request).catch(() => undefined);
}

export function scheduleHighlightedCodePreload(request: HighlightedCodeRequest): () => void {
  if (!request.code || readHighlightedCode(request) || !resolveSupportedHighlightLanguage(request.language)) {
    return noop;
  }

  if (typeof window === "undefined") {
    return noop;
  }

  const preload = (): void => preloadHighlightedCode(request);
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(preload);
    return () => window.cancelIdleCallback(handle);
  }

  const handle = window.setTimeout(preload, 0);
  return () => window.clearTimeout(handle);
}

export function loadingHighlightedCode(): HighlightedCodeState {
  return { status: "loading" };
}

export function readHighlightCacheKey({ code, language }: HighlightedCodeRequest): string {
  const languageKey = resolveSupportedHighlightLanguage(language) ?? normalizeLanguage(language);
  return [CODE_HIGHLIGHT_THEME, languageKey, code].join("\u0000");
}

export function resolveSupportedHighlightLanguage(language: string): SupportedHighlightLanguage | null {
  const normalizedLanguage = normalizeLanguage(language);
  if (isSupportedHighlightLanguage(normalizedLanguage)) return normalizedLanguage;
  return HIGHLIGHT_LANGUAGE_ALIASES[normalizedLanguage] ?? null;
}

async function highlightCodeWithRuntime(request: HighlightedCodeRequest): Promise<string> {
  const language = resolveSupportedHighlightLanguage(request.language);
  if (!language) {
    throw new Error(`Unsupported code language: ${request.language}`);
  }
  const { codeToHtml } = await getHighlightRuntime();
  const codeLineAttributesTransformer: ShikiTransformer = {
    name: "senera-code-line-attributes",
    line(node) {
      node.properties["data-line"] = "";
    },
  };
  return codeToHtml(request.code, {
    lang: language,
    theme: CODE_HIGHLIGHT_THEME,
    colorReplacements: {
      "#ffffff": "transparent",
      "#fff": "transparent",
    },
    transformers: [codeLineAttributesTransformer],
  });
}

function isSupportedHighlightLanguage(language: string): language is SupportedHighlightLanguage {
  return Object.prototype.hasOwnProperty.call(HIGHLIGHT_LANGUAGE_LOADERS, language);
}

function getHighlightRuntime(): Promise<HighlightRuntime> {
  if (!highlightRuntime) {
    highlightRuntime = createHighlightRuntime().catch((error: unknown) => {
      highlightRuntime = undefined;
      throw error;
    });
  }
  return highlightRuntime;
}

async function createHighlightRuntime() {
  const [
    { createBundledHighlighter, createSingletonShorthands, guessEmbeddedLanguages },
    { createJavaScriptRegexEngine },
  ] = await Promise.all([
    import("@shikijs/core"),
    import("@shikijs/engine-javascript"),
  ]);
  const createHighlighter = createBundledHighlighter({
    langs: HIGHLIGHT_LANGUAGE_LOADERS,
    themes: HIGHLIGHT_THEMES,
    engine: () => createJavaScriptRegexEngine(),
  });
  const { codeToHtml } = createSingletonShorthands(createHighlighter, {
    guessEmbeddedLanguages,
  });
  return { codeToHtml };
}

function noop(): void {
}
