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
    backgroundColor: "#fffdf8",
    color: "#211f1b",
    fontSize: "13px",
    height: "100%",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    lineHeight: "1.65",
    scrollbarColor: "rgba(28, 26, 23, 0.16) transparent",
    scrollbarGutter: "stable",
  },
  ".cm-scroller::-webkit-scrollbar": {
    height: "8px",
    width: "8px",
  },
  ".cm-scroller::-webkit-scrollbar-thumb": {
    background: "rgba(28, 26, 23, 0.16)",
    backgroundClip: "padding-box",
    border: "2px solid transparent",
    borderRadius: "999px",
  },
  ".cm-scroller::-webkit-scrollbar-thumb:hover": {
    background: "rgba(28, 26, 23, 0.26)",
    backgroundClip: "padding-box",
  },
  ".cm-content": {
    caretColor: "#8c4d22",
    minHeight: "100%",
    paddingBottom: "16px",
    paddingTop: "16px",
  },
  ".cm-line": {
    paddingLeft: "18px",
    paddingRight: "18px",
  },
  ".cm-gutters": {
    backgroundColor: "#f5efe4",
    borderRight: "1px solid rgba(28, 26, 23, 0.1)",
    color: "rgba(28, 26, 23, 0.42)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "40px",
    paddingLeft: "8px",
    paddingRight: "10px",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(176, 111, 65, 0.07)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(176, 111, 65, 0.09)",
    color: "#6b4a35",
  },
  ".cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "rgba(176, 111, 65, 0.18) !important",
  },
  ".cm-cursor": {
    borderLeftColor: "#8c4d22",
  },
});

const editorHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#8c4d22", fontWeight: "600" },
  { tag: [tags.string, tags.special(tags.string)], color: "#50683c" },
  { tag: tags.propertyName, color: "#6f5f45", fontWeight: "600" },
  { tag: [tags.number, tags.bool, tags.null], color: "#276b75" },
  { tag: [tags.comment, tags.docComment], color: "#8c8578", fontStyle: "italic" },
  { tag: [tags.name, tags.variableName], color: "#2f3437" },
  { tag: tags.punctuation, color: "#8d8678" },
  { tag: tags.invalid, color: "#b3441f" },
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
