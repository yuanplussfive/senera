import type { ChatMessage } from "../../store/sessionStore";
import { cn, formatTime } from "../../lib/util";
import { Dialog, DialogClose, DialogContent } from "../ui/Dialog";

export function DeleteMessageDialog({
  message,
  open,
  onOpenChange,
  onConfirm,
}: {
  message: ChatMessage | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (message: ChatMessage) => void;
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="从此处删除"
        description="这一条及之后的消息会从后端永久移除。"
        className="w-[min(420px,calc(100vw-28px))]"
        bodyClassName="px-4 pb-4 pt-3"
      >
        <div className="space-y-3">
          <p className="text-[12.5px] leading-5 text-ink-600">
            删除后无法通过刷新恢复，后续回复也会一起移除。
          </p>
          {message ? (
            <div className="rounded-lg border border-ink-200/70 bg-paper-100/65 px-3 py-2.5">
              <div className="mb-1 font-mono text-[10.5px] text-ink-400">
                {formatTime(message.createdAt)}
              </div>
              <p className="line-clamp-3 whitespace-pre-wrap text-[12.5px] leading-5 text-ink-700">
                {message.content || "（空内容）"}
              </p>
            </div>
          ) : null}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <button
              type="button"
              className="h-8 rounded-md px-3 text-[12.5px] text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900"
            >
              取消
            </button>
          </DialogClose>
          <button
            type="button"
            onClick={() => {
              if (!message) return;
              onConfirm(message);
              onOpenChange(false);
            }}
            className={cn(
              "h-8 rounded-md bg-brick-500 px-3 text-[12.5px] font-medium text-paper-50 transition",
              "hover:bg-brick-600 focus:outline-none focus:ring-2 focus:ring-brick-200/60",
            )}
          >
            永久删除
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
