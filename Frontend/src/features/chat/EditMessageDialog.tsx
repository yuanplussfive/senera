import { CornerDownLeft } from "lucide-react";
import { toast } from "sonner";
import type { ChatMessage } from "../../store/sessionStore";
import { cn, formatTime } from "../../lib/util";
import { Dialog, DialogActionButton, DialogActions, DialogContent, ScrollArea } from "../../shared/ui";

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
      toast.error("内容不能为空");
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
      <DialogContent title="编辑用户消息" description="保存后会从这条消息开始重新生成后续回复。">
        <div className="flex max-h-[calc(100vh-140px)] flex-col bg-paper-50">
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-[12px] text-ink-500">
            <span className="min-w-0 truncate">
              {editing?.message.createdAt ? `原消息 · ${formatTime(editing.message.createdAt)}` : "原消息"}
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
                placeholder="输入修改后的用户消息..."
                autoFocus
              />
              <div className="flex items-center justify-between border-t border-ink-200/70 px-3.5 py-2 text-[11.5px] text-ink-500">
                <span>Esc 取消</span>
                <span>{draft.trim().length} 字符</span>
              </div>
            </div>
          </ScrollArea>

          <div className="flex flex-col gap-2 border-t border-ink-200/70 bg-paper-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-[12px] leading-relaxed text-ink-500">
              当前消息之后的回复会被替换。
            </div>
            <DialogActions className="items-center">
              <DialogActionButton
                className="inline-flex items-center border border-ink-200/80 bg-paper-50 text-ink-700 hover:bg-ink-900/[0.04] hover:text-ink-700"
                onClick={onClose}
              >
                取消
              </DialogActionButton>
              <DialogActionButton
                className="inline-flex items-center px-3.5 hover:bg-ink-900/90"
                disabled={!draft.trim()}
                onClick={submit}
                variant="primary"
              >
                保存并重新回答
              </DialogActionButton>
            </DialogActions>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
