import { useLayoutEffect, useRef } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";

export interface InlineMessageEditorProps {
  draft: string;
  onDraftChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function InlineMessageEditor({
  draft,
  onDraftChange,
  onCancel,
  onSubmit,
}: InlineMessageEditorProps): JSX.Element {
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    if (!editorRef.current) return;
    const editor = editorRef.current;
    editor.style.height = "0px";
    editor.style.height = `${Math.min(editor.scrollHeight, 320)}px`;
  }, [draft]);

  const submit = (): void => {
    if (draft.trim()) onSubmit();
  };

  return (
    <form
      className="mt-1 w-[min(720px,calc(100vw-96px))] max-w-full overflow-hidden rounded-lg rounded-tr-sm border border-ink-300 bg-paper-50"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={editorRef}
        autoFocus
        rows={1}
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
            return;
          }
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
        className="block min-h-[88px] max-h-[320px] w-full resize-none overflow-y-auto bg-transparent px-3.5 py-3 text-[length:var(--theme-chat-user-font-size)] leading-[var(--theme-chat-user-line-height)] text-ink-900 outline-none"
        aria-label={frontendMessage("chat.editDialog.title")}
        placeholder={frontendMessage("chat.editDialog.placeholder")}
      />
      <div className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-ink-200/70 px-2.5 py-2 sm:flex-nowrap sm:py-1.5">
        <span className="w-full text-[11.5px] leading-4 text-ink-500 sm:min-w-0 sm:flex-1 sm:truncate">
          {frontendMessage("chat.editDialog.replaceWarning")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 cursor-pointer rounded-md px-2.5 text-[12.5px] text-ink-600 transition-colors hover:bg-ink-900/[0.05] hover:text-ink-900"
          >
            {frontendMessage("ui.cancel")}
          </button>
          <button
            type="submit"
            disabled={!draft.trim()}
            className="h-8 cursor-pointer rounded-md bg-ink-900 px-3 text-[12.5px] font-medium text-paper-50 transition-colors hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {frontendMessage("chat.editDialog.confirm")}
          </button>
        </div>
      </div>
    </form>
  );
}
