import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import type { Extension } from "@codemirror/state";
import type { CodeTextEditorLanguage } from "../code/CodeTextEditor";

export interface WorkspaceEditorLanguage {
  readonly language: CodeTextEditorLanguage;
  readonly extensions: readonly Extension[];
}

const JavascriptExtensions = new Set([".js", ".jsx", ".mjs", ".cjs"]);
const TypescriptExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);
const JsonExtensions = new Set([".json", ".jsonc", ".jsonl"]);
const MarkdownExtensions = new Set([".md", ".mdx", ".markdown"]);
const CssExtensions = new Set([".css", ".scss", ".sass", ".less"]);
const HtmlExtensions = new Set([".html", ".htm"]);
const PythonExtensions = new Set([".py", ".pyi"]);
const YamlExtensions = new Set([".yaml", ".yml"]);
const XmlExtensions = new Set([".xml", ".svg"]);

export function resolveWorkspaceEditorLanguage(name: string): WorkspaceEditorLanguage {
  const extension = readExtension(name);
  if (JsonExtensions.has(extension)) return { language: "json", extensions: [] };
  if (MarkdownExtensions.has(extension)) return { language: "markdown", extensions: [] };
  if (JavascriptExtensions.has(extension)) {
    return { language: "text", extensions: [javascript({ jsx: extension === ".jsx" })] };
  }
  if (TypescriptExtensions.has(extension)) {
    return { language: "text", extensions: [javascript({ typescript: true, jsx: extension === ".tsx" })] };
  }
  if (CssExtensions.has(extension)) return { language: "text", extensions: [css()] };
  if (HtmlExtensions.has(extension)) return { language: "text", extensions: [html()] };
  if (PythonExtensions.has(extension)) return { language: "text", extensions: [python()] };
  if (YamlExtensions.has(extension)) return { language: "text", extensions: [yaml()] };
  if (XmlExtensions.has(extension)) return { language: "text", extensions: [xml()] };
  return { language: "text", extensions: [] };
}

function readExtension(name: string): string {
  const normalized = name.trim().toLowerCase();
  const index = normalized.lastIndexOf(".");
  return index >= 0 ? normalized.slice(index) : "";
}
