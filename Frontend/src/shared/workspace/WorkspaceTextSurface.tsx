import { useMemo } from "react";
import type { FileContents } from "@pierre/diffs";
import { LazyMarkdownRenderer } from "../code/LazyMarkdownRenderer";
import { CodePreviewFrame } from "../code/CodePreviewFrame";
import { WorkspaceSourceView } from "./WorkspaceSourceView";
import { WorkspaceJsonSurface } from "./WorkspaceJsonSurface";
import type { WorkspaceTextPresentation, WorkspaceTextView } from "./WorkspaceTextPresentation";
import "./WorkspaceTextSurface.css";

/** The editor owns its live document; change notifications only update the save draft. */
export function WorkspaceTextSurface({
  content,
  name,
  cacheKey,
  editing,
  line,
  column,
  onChange,
  presentation,
  view,
}: {
  content: string;
  name: string;
  cacheKey: string;
  editing: boolean;
  line?: number;
  column?: number;
  onChange: (value: string) => void;
  presentation?: WorkspaceTextPresentation;
  view: WorkspaceTextView;
}): JSX.Element {
  const file = useMemo<FileContents>(() => ({ name, contents: content, cacheKey }), [name, content, cacheKey]);
  return (
    <div className="flex h-full min-h-0 flex-col" data-workspace-text-surface data-editing={editing}>
      {!editing && view === "preview" && presentation?.codePreview ? (
        <CodePreviewFrame
          preview={presentation.codePreview}
          title={`${name} ${presentation.codePreview.label}`}
          className="bg-surface-panel"
        />
      ) : !editing && view === "preview" ? (
        <div className="min-h-0 flex-1 overflow-auto p-5 sm:p-8" data-workspace-preview-scroll>
          <LazyMarkdownRenderer
            className="assistant-turn-content mx-auto min-w-0"
            contentClassName="text-[length:var(--theme-chat-assistant-font-size-scaled)] leading-[var(--theme-chat-assistant-line-height)] text-content-primary"
          >
            {content}
          </LazyMarkdownRenderer>
        </div>
      ) : !editing && view === "structure" ? (
        <WorkspaceJsonSurface content={content} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col" data-workspace-code>
          <WorkspaceSourceView file={file} editing={editing} line={line} column={column} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
