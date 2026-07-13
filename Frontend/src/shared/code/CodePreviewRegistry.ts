import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import * as parse5 from "parse5";
import { defaultTreeAdapter, type DefaultTreeAdapterTypes } from "parse5";

export interface CodePreview {
  id: string;
  label: string;
  source: string;
  sandbox: string;
}

export interface CodePreviewThemeVariables {
  scrollbarThumb: string;
  scrollbarThumbHover: string;
  scrollbarTrack: string;
  scrollbarSize: string;
}

interface CodePreviewContext {
  language: string;
  code: string;
}

interface CodePreviewProvider {
  id: string;
  label: string;
  languages: readonly string[];
  detect: (context: CodePreviewContext) => boolean;
  build: (context: CodePreviewContext) => CodePreview;
}

const previewProviders: readonly CodePreviewProvider[] = [
  {
    id: "html-document",
    label: frontendMessage("runtime.migrated.shared.code.CodePreviewRegistry.34.12"),
    languages: ["html", "htm"],
    detect: ({ code }) => parseHtmlSource(code).hasRenderableContent,
    build: ({ code }) => ({
      id: "html-document",
      label: frontendMessage("runtime.migrated.shared.code.CodePreviewRegistry.39.14"),
      source: buildPreviewDocument(code),
      sandbox: "allow-forms allow-modals allow-pointer-lock allow-popups",
    }),
  },
  {
    id: "svg-document",
    label: frontendMessage("runtime.migrated.shared.code.CodePreviewRegistry.46.12"),
    languages: ["svg"],
    detect: ({ code }) => parseHtmlSource(code).hasElement("svg"),
    build: ({ code }) => ({
      id: "svg-document",
      label: frontendMessage("runtime.migrated.shared.code.CodePreviewRegistry.51.14"),
      source: buildPreviewDocument(code),
      sandbox: "allow-pointer-lock allow-popups",
    }),
  },
];

const defaultCodePreviewThemeVariables: CodePreviewThemeVariables = {
  scrollbarThumb: "rgb(28 26 23 / 0.16)",
  scrollbarThumbHover: "rgb(28 26 23 / 0.26)",
  scrollbarTrack: "transparent",
  scrollbarSize: "8px",
};

export function resolveCodePreview(language: string, code: string): CodePreview | null {
  const normalizedLanguage = normalizeLanguage(language);
  const context = { language: normalizedLanguage, code };
  const provider = previewProviders.find(
    (candidate) =>
      candidate.languages.includes(normalizedLanguage) && candidate.detect(context),
  );
  return provider ? provider.build(context) : null;
}

export function defaultCodeFilename(language: string): string {
  const normalized = normalizeLanguage(language);
  const extension = extensionByLanguage[normalized] ?? normalized;
  return `snippet.${extension || "txt"}`;
}

export function readDownloadMime(language: string): string {
  const normalized = normalizeLanguage(language);
  return mimeByLanguage[normalized] ?? "text/plain;charset=utf-8";
}

export function normalizeLanguage(language: string): string {
  return language.trim().toLowerCase();
}

export function createCodePreviewThemeVariables(
  cssVariables: Record<string, string>,
): CodePreviewThemeVariables {
  return {
    scrollbarThumb: cssVariables["--scrollbar-thumb"] ?? defaultCodePreviewThemeVariables.scrollbarThumb,
    scrollbarThumbHover: cssVariables["--scrollbar-thumb-hover"] ?? defaultCodePreviewThemeVariables.scrollbarThumbHover,
    scrollbarTrack: cssVariables["--scrollbar-track"] ?? defaultCodePreviewThemeVariables.scrollbarTrack,
    scrollbarSize: cssVariables["--scrollbar-size"] ?? defaultCodePreviewThemeVariables.scrollbarSize,
  };
}

export function applyCodePreviewTheme(
  source: string,
  variables: CodePreviewThemeVariables,
): string {
  const document = parse5.parse(source);
  replaceHeadStyle(document, "data-senera-preview-theme", createPreviewThemeStyle(variables));
  return parse5.serialize(document);
}

const extensionByLanguage: Record<string, string> = {
  html: "html",
  htm: "html",
  css: "css",
  javascript: "js",
  js: "js",
  typescript: "ts",
  ts: "ts",
  jsx: "jsx",
  tsx: "tsx",
  json: "json",
  svg: "svg",
  markdown: "md",
  md: "md",
  text: "txt",
};

const mimeByLanguage: Record<string, string> = {
  html: "text/html;charset=utf-8",
  htm: "text/html;charset=utf-8",
  css: "text/css;charset=utf-8",
  javascript: "text/javascript;charset=utf-8",
  js: "text/javascript;charset=utf-8",
  typescript: "text/plain;charset=utf-8",
  ts: "text/plain;charset=utf-8",
  json: "application/json;charset=utf-8",
  svg: "image/svg+xml;charset=utf-8",
  markdown: "text/markdown;charset=utf-8",
  md: "text/markdown;charset=utf-8",
};

function parseHtmlSource(code: string): {
  hasRenderableContent: boolean;
  hasElement: (tagName: string) => boolean;
} {
  const fragment = parse5.parseFragment(code);
  const document = parse5.parse(code);
  const hasElement = (tagName: string): boolean =>
    hasNodeNamed(fragment, tagName) || hasNodeNamed(document, tagName);
  return {
    hasRenderableContent: hasAnyElement(fragment) || hasAnyElement(document),
    hasElement,
  };
}

function buildPreviewDocument(code: string): string {
  const document = parse5.parse(code);
  const fragment = parse5.parseFragment(code);
  const sourceDocument = isCompleteHtmlSource(fragment)
    ? document
    : createDocumentFromFragment(fragment);
  injectHeadStyle(
    sourceDocument,
    createPreviewScrollbarStyle(),
    "data-senera-scrollbar",
  );
  return parse5.serialize(sourceDocument);
}

function createPreviewScrollbarStyle(): string {
  return `
:root {
  --senera-preview-scrollbar-thumb: ${defaultCodePreviewThemeVariables.scrollbarThumb};
  --senera-preview-scrollbar-thumb-hover: ${defaultCodePreviewThemeVariables.scrollbarThumbHover};
  --senera-preview-scrollbar-track: ${defaultCodePreviewThemeVariables.scrollbarTrack};
  --senera-preview-scrollbar-size: ${defaultCodePreviewThemeVariables.scrollbarSize};
  scrollbar-color: var(--senera-preview-scrollbar-thumb) var(--senera-preview-scrollbar-track);
  scrollbar-width: thin;
}
html,
body {
  scrollbar-gutter: stable;
}
::-webkit-scrollbar {
  width: var(--senera-preview-scrollbar-size);
  height: var(--senera-preview-scrollbar-size);
}
::-webkit-scrollbar-thumb {
  background: var(--senera-preview-scrollbar-thumb);
  border: 2px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--senera-preview-scrollbar-thumb-hover);
  border: 2px solid transparent;
  background-clip: padding-box;
}
::-webkit-scrollbar-track {
  background: var(--senera-preview-scrollbar-track);
}
`;
}

function createPreviewThemeStyle({
  scrollbarSize,
  scrollbarThumb,
  scrollbarThumbHover,
  scrollbarTrack,
}: CodePreviewThemeVariables): string {
  return `
:root {
  --senera-preview-scrollbar-thumb: ${scrollbarThumb};
  --senera-preview-scrollbar-thumb-hover: ${scrollbarThumbHover};
  --senera-preview-scrollbar-track: ${scrollbarTrack};
  --senera-preview-scrollbar-size: ${scrollbarSize};
}
`;
}

function createDocumentFromFragment(fragment: ParseNode): DefaultTreeAdapterTypes.Document {
  const document = parse5.parse("<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>");
  const body = findNodeNamed(document, "body");
  if (isParentNode(body) && isParentNode(fragment)) {
    body.childNodes = [...fragment.childNodes];
  }
  return document;
}

function injectHeadStyle(document: ParseNode, css: string, attributeName: string): void {
  const head = findNodeNamed(document, "head");
  if (!isParentNode(head)) return;
  defaultTreeAdapter.appendChild(head, createStyleElement(css, attributeName));
}

function replaceHeadStyle(document: ParseNode, attributeName: string, css: string): void {
  const head = findNodeNamed(document, "head");
  if (!isParentNode(head)) return;
  const existingIndex = head.childNodes.findIndex(
    (child) => isStyleElementWithAttribute(child, attributeName),
  );
  const style = createStyleElement(css, attributeName);
  if (existingIndex >= 0) {
    head.childNodes.splice(existingIndex, 1, style);
    return;
  }
  defaultTreeAdapter.appendChild(head, style);
}

function findNodeNamed(node: ParseNode | null, tagName: string): ParseNode | null {
  if (!node) return null;
  if (node.nodeName === tagName) return node;
  if (!isParentNode(node)) return null;
  for (const child of node.childNodes) {
    const match = findNodeNamed(child, tagName);
    if (match) return match;
  }
  return null;
}

function hasNodeNamed(node: ParseNode | null, tagName: string): boolean {
  return !!findNodeNamed(node, tagName);
}

function isCompleteHtmlSource(fragment: ParseNode): boolean {
  return hasNodeNamed(fragment, "html");
}

function hasAnyElement(node: ParseNode): boolean {
  if (isElementNode(node)) return true;
  if (!isParentNode(node)) return false;
  return node.childNodes.some((child) => hasAnyElement(child));
}

function createStyleElement(css: string, attributeName: string): DefaultTreeAdapterTypes.Element {
  const style = defaultTreeAdapter.createElement("style", parse5.html.NS.HTML, [
    { name: attributeName, value: "" },
  ]);
  defaultTreeAdapter.insertText(style, css);
  return style;
}

function isStyleElementWithAttribute(
  node: ParseNode | null,
  attributeName: string,
): node is DefaultTreeAdapterTypes.Element {
  return isElementNode(node)
    && node.tagName === "style"
    && node.attrs.some((attribute) => attribute.name === attributeName);
}

function isElementNode(node: ParseNode | null): node is DefaultTreeAdapterTypes.Element {
  if (!node) return false;
  return "tagName" in node;
}

function isParentNode(node: ParseNode | null): node is DefaultTreeAdapterTypes.ParentNode {
  if (!node) return false;
  return "childNodes" in node;
}

type ParseNode = DefaultTreeAdapterTypes.Node;
