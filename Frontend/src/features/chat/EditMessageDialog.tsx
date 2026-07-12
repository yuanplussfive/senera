import { CornerDownLeft } from "lucide-react";
import { toast } from "sonner";
import type { ChatMessage } from "../../store/sessionStore";
import { cn, formatTime } from "../../lib/util";
import { Dialog, DialogActionButton, DialogActions, DialogContent, ScrollArea } from "../../shared/ui";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";

export function EditMessageDialog({
  editing,
  draft,
  onDraftChange,
  onClose,
  onSubmit,
}: {
  editing: { id: string; message: ChatMessage } | null;
  draft: string;
  onDraftChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (message: ChatMessage, nextContent: string) => void;
}): JSX.Element {
  const submit = (): void => {
    const target = editing?.message;
    if (!target) return;
    const next = draft.trim();
    if (!next) {
      toast.error(frontendMessage("chat.contentRequired"));
      return;
    }
    onSubmit(target, next);
  };

  return (
    <Dialog
      open={!!editing}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={frontendMessage("chat.editDialog.title")}
        description={frontendMessage("chat.editDialog.description")}
      >
        <div className="flex max-h-[calc(100vh-140px)] flex-col bg-paper-50">
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-[12px] text-ink-500">
            <span className="min-w-0 truncate">
              {editing?.message.createdAt
                ? frontendMessage("chat.editDialog.originalMessageAt", { time: formatTime(editing.message.createdAt) })
                : frontendMessage("chat.editDialog.originalMessage")}
            </span>
            <span className="hidden flex-shrink-0 items-center gap-1.5 sm:inline-flex">
              <CornerDownLeft className="h-3.5 w-3.5" />
              Ctrl/⌘ + Enter
            </span>
          </div>

          <ScrollArea className="flex-1" viewportClassName="px-4 pb-4">
            <div className="overflow-hidden rounded-lg border border-ink-200/80 bg-paper-100/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
              <textarea
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    onClose();
                    return;
                  }
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={14}
                className={cn(
                  "block min-h-[260px] w-full resize-none border-0 bg-transparent px-3.5 py-3",
                  "text-[13.5px] leading-relaxed text-ink-900 outline-none placeholder:text-ink-300",
                  "focus:ring-0",
                )}
                placeholder={frontendMessage("chat.editDialog.placeholder")}
                autoFocus
              />
              <div className="flex items-center justify-between border-t border-ink-200/70 px-3.5 py-2 text-[11.5px] text-ink-500">
                <span>{frontendMessage("chat.editDialog.cancelHint")}</span>
                <span>{frontendMessage("chat.editDialog.characterCount", { count: draft.trim().length })}</span>
              </div>
            </div>
          </ScrollArea>

          <div className="flex flex-col gap-2 border-t border-ink-200/70 bg-paper-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-[12px] leading-relaxed text-ink-500">
              {frontendMessage("chat.editDialog.replaceWarning")}
            </div>
            <DialogActions className="items-center">
              <DialogActionButton
                className="inline-flex items-center border border-ink-200/80 bg-paper-50 text-ink-700 hover:bg-ink-900/[0.04] hover:text-ink-700"
                onClick={onClose}
              >
                {frontendMessage("ui.cancel")}
              </DialogActionButton>
              <DialogActionButton
                className="inline-flex items-center px-3.5 hover:bg-ink-900/90"
                disabled={!draft.trim()}
                onClick={submit}
                variant="primary"
              >
                {frontendMessage("chat.editDialog.confirm")}
              </DialogActionButton>
            </DialogActions>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
