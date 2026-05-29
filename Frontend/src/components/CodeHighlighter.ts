import {
  bundledLanguages,
  codeToHtml,
  type BundledLanguage,
  type BundledTheme,
  type ShikiTransformer,
} from "shiki";
import { LruCache } from "../lib/LruCache";
import { normalizeLanguage } from "./CodePreviewRegistry";

export interface HighlightedCodeRequest {
  code: string;
  language: string;
}

export type HighlightedCodeState =
  | { status: "loading" }
  | { status: "ready"; html: string }
  | { status: "failed"; reason: unknown };

const CODE_HIGHLIGHT_THEME: BundledTheme = "github-light";
const codeHighlightCache = new LruCache<string, Promise<string>>(80);
const codeLineAttributesTransformer: ShikiTransformer = {
  name: "senera-code-line-attributes",
  line(node) {
    node.properties["data-line"] = "";
  },
};

export function readHighlightedCode(request: HighlightedCodeRequest): Promise<string> | undefined {
  return codeHighlightCache.get(readHighlightCacheKey(request));
}

export function highlightCode(request: HighlightedCodeRequest): Promise<string> {
  const cacheKey = readHighlightCacheKey(request);
  const cached = codeHighlightCache.get(cacheKey);
  if (cached) return cached;

  const language = resolveHighlightLanguage(request.language);
  if (!language) {
    return Promise.reject(new Error(`Unsupported code language: ${request.language}`));
  }

  const highlighted = codeToHtml(request.code, {
    lang: language,
    theme: CODE_HIGHLIGHT_THEME,
    colorReplacements: {
      "#ffffff": "transparent",
      "#fff": "transparent",
    },
    transformers: [codeLineAttributesTransformer],
  });

  codeHighlightCache.set(cacheKey, highlighted);
  return highlighted;
}

export function preloadHighlightedCode(request: HighlightedCodeRequest): void {
  if (!request.code || !resolveHighlightLanguage(request.language)) return;
  void highlightCode(request).catch(() => undefined);
}

export function scheduleHighlightedCodePreload(request: HighlightedCodeRequest): () => void {
  if (!request.code || readHighlightedCode(request) || !resolveHighlightLanguage(request.language)) {
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

function resolveHighlightLanguage(language: string): BundledLanguage | null {
  const normalized = normalizeLanguage(language);
  return isBundledLanguage(normalized) ? normalized : null;
}

function isBundledLanguage(language: string): language is BundledLanguage {
  return language in bundledLanguages;
}

function readHighlightCacheKey({ code, language }: HighlightedCodeRequest): string {
  return [CODE_HIGHLIGHT_THEME, normalizeLanguage(language), code].join("\u0000");
}

function noop(): void {
}
