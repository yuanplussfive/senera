import * as parse5 from "parse5";
import { defaultTreeAdapter, type DefaultTreeAdapterTypes } from "parse5";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";

export interface CodePreview {
  id: string;
  label: string;
  source: string;
  sandbox: string;
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
    label: frontendMessage("code.preview"),
    languages: ["html", "htm"],
    detect: ({ code }) => parseHtmlSource(code).hasRenderableContent,
    build: ({ code }) => ({
      id: "html-document",
      label: frontendMessage("code.preview"),
      source: buildPreviewDocument(code),
      sandbox: "allow-forms allow-modals allow-pointer-lock allow-popups",
    }),
  },
  {
    id: "svg-document",
    label: frontendMessage("code.preview"),
    languages: ["svg"],
    detect: ({ code }) => parseHtmlSource(code).hasElement("svg"),
    build: ({ code }) => ({
      id: "svg-document",
      label: frontendMessage("code.preview"),
      source: buildPreviewDocument(code),
      sandbox: "allow-pointer-lock allow-popups",
    }),
  },
];

export function resolveCodePreview(language: string, code: string): CodePreview | null {
  const normalizedLanguage = normalizeLanguage(language);
  const context = { language: normalizedLanguage, code };
  const provider = previewProviders.find(
    (candidate) => candidate.languages.includes(normalizedLanguage) && candidate.detect(context),
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
  const hasElement = (tagName: string): boolean => hasNodeNamed(fragment, tagName) || hasNodeNamed(document, tagName);
  return {
    hasRenderableContent: hasAnyElement(fragment) || hasAnyElement(document),
    hasElement,
  };
}

function buildPreviewDocument(code: string): string {
  const document = parse5.parse(code);
  const fragment = parse5.parseFragment(code);
  const sourceDocument = isCompleteHtmlSource(fragment) ? document : createDocumentFromFragment(fragment);
  injectHeadStyle(sourceDocument, createPreviewScrollbarStyle());
  return parse5.serialize(sourceDocument);
}

function createPreviewScrollbarStyle(): string {
  return `
:root {
  scrollbar-color: rgba(28, 26, 23, 0.16) transparent;
  scrollbar-width: thin;
}
html,
body {
  scrollbar-gutter: stable;
}
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-thumb {
  background: rgba(28, 26, 23, 0.16);
  border: 2px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(28, 26, 23, 0.26);
  border: 2px solid transparent;
  background-clip: padding-box;
}
::-webkit-scrollbar-track {
  background: transparent;
}
`;
}

function createDocumentFromFragment(fragment: ParseNode): DefaultTreeAdapterTypes.Document {
  const document = parse5.parse('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  const body = findNodeNamed(document, "body");
  if (isParentNode(body) && isParentNode(fragment)) {
    body.childNodes = [...fragment.childNodes];
  }
  return document;
}

function injectHeadStyle(document: ParseNode, css: string): void {
  const head = findNodeNamed(document, "head");
  if (!isParentNode(head)) return;
  defaultTreeAdapter.appendChild(head, createStyleElement(css));
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

function createStyleElement(css: string): DefaultTreeAdapterTypes.Element {
  const style = defaultTreeAdapter.createElement("style", parse5.html.NS.HTML, [
    { name: "data-senera-scrollbar", value: "" },
  ]);
  defaultTreeAdapter.insertText(style, css);
  return style;
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
