import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { tags } from "@lezer/highlight";
import { useMemo } from "react";
import { cn } from "../../lib/util";

export type CodeTextEditorLanguage = "json" | "markdown" | "text";

export interface CodeTextEditorProps {
  value: string;
  language: CodeTextEditorLanguage;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  onChange: (value: string) => void;
}

const languageExtensions: Record<CodeTextEditorLanguage, () => Extension[]> = {
  json: () => [json()],
  markdown: () => [markdown()],
  text: () => [],
};

const editorTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--theme-code-editor-bg)",
    color: "var(--theme-code-editor-fg)",
    fontSize: "13px",
    height: "100%",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    lineHeight: "1.65",
    scrollbarColor: "var(--scrollbar-thumb) var(--scrollbar-track)",
    scrollbarGutter: "stable",
  },
  ".cm-scroller::-webkit-scrollbar": {
    height: "8px",
    width: "8px",
  },
  ".cm-scroller::-webkit-scrollbar-thumb": {
    background: "var(--scrollbar-thumb)",
    backgroundClip: "padding-box",
    border: "2px solid transparent",
    borderRadius: "999px",
  },
  ".cm-scroller::-webkit-scrollbar-thumb:hover": {
    background: "var(--scrollbar-thumb-hover)",
    backgroundClip: "padding-box",
  },
  ".cm-content": {
    caretColor: "var(--theme-code-editor-caret)",
    minHeight: "100%",
    paddingBottom: "16px",
    paddingTop: "16px",
  },
  ".cm-line": {
    paddingLeft: "18px",
    paddingRight: "18px",
  },
  ".cm-gutters": {
    backgroundColor: "var(--theme-code-editor-gutter-bg)",
    borderRight: "1px solid var(--theme-code-editor-gutter-border)",
    color: "var(--theme-code-editor-gutter-fg)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "40px",
    paddingLeft: "8px",
    paddingRight: "10px",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--theme-code-editor-active-line-bg)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--theme-code-editor-active-gutter-bg)",
    color: "var(--theme-code-editor-active-gutter-fg)",
  },
  ".cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--theme-code-editor-selection-bg) !important",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--theme-code-editor-caret)",
  },
});

const editorHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--theme-code-token-keyword)", fontWeight: "600" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--theme-code-token-string)" },
  { tag: tags.propertyName, color: "var(--theme-code-token-property)", fontWeight: "600" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--theme-code-token-literal)" },
  { tag: [tags.comment, tags.docComment], color: "var(--theme-code-token-comment)", fontStyle: "italic" },
  { tag: [tags.name, tags.variableName], color: "var(--theme-code-token-name)" },
  { tag: tags.punctuation, color: "var(--theme-code-token-punctuation)" },
  { tag: tags.invalid, color: "var(--theme-code-token-invalid)" },
]);

const editorBaseExtensions = [editorTheme, syntaxHighlighting(editorHighlightStyle), EditorView.lineWrapping];

export function CodeTextEditor({
  ariaLabel,
  className,
  disabled = false,
  language,
  onChange,
  value,
}: CodeTextEditorProps): JSX.Element {
  const extensions = useMemo(() => [...editorBaseExtensions, ...languageExtensions[language]()], [language]);

  return (
    <CodeMirror
      aria-label={ariaLabel}
      basicSetup={{
        autocompletion: false,
        bracketMatching: true,
        closeBrackets: true,
        foldGutter: true,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
        lineNumbers: true,
        searchKeymap: true,
      }}
      className={cn("h-full min-h-0 overflow-hidden", className)}
      editable={!disabled}
      extensions={extensions}
      height="100%"
      readOnly={disabled}
      value={value}
      onChange={onChange}
    />
  );
}
