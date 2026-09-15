import type { ChatMessage } from "../../store/sessionStore";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { formatTime } from "../../lib/util";
import { Dialog, DialogActionButton, DialogActions, DialogContent } from "../../shared/ui";

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
        title={frontendMessage("chat.deleteDialog.title")}
        description={frontendMessage("chat.deleteDialog.description")}
        className="w-[min(420px,calc(100vw-28px))]"
        bodyClassName="px-4 pb-4 pt-3"
      >
        <div className="space-y-3">
          <p className="text-[12.5px] leading-5 text-ink-600">{frontendMessage("chat.deleteDialog.warning")}</p>
          {message ? (
            <div className="rounded-lg border border-ink-200/70 bg-paper-100/65 px-3 py-2.5">
              <div className="mb-1 font-mono text-[10.5px] text-ink-400">{formatTime(message.createdAt)}</div>
              <p className="line-clamp-3 whitespace-pre-wrap text-[12.5px] leading-5 text-ink-700">
                {message.content || frontendMessage("chat.deleteDialog.emptyMessage")}
              </p>
            </div>
          ) : null}
        </div>
        <DialogActions className="mt-5">
          <DialogActionButton close>{frontendMessage("ui.cancel")}</DialogActionButton>
          <DialogActionButton
            onClick={() => {
              if (!message) return;
              onConfirm(message);
              onOpenChange(false);
            }}
            variant="danger"
          >
            {frontendMessage("chat.deleteDialog.confirm")}
          </DialogActionButton>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
