import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { CircleAlert } from "lucide-react";
import { useEffect, useRef } from "react";
import { Dialog, DialogActionButton, DialogActions, DialogContent } from "../../shared/ui";
import type { ConfirmationIntent } from "./types";

export function RenameDialog({
  open,
  title,
  value,
  returnFocus,
  onValueChange,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  value: string;
  returnFocus: HTMLElement | null;
  onValueChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus({ preventScroll: true });
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={frontendMessage("session.renameDialogTitle")}
        description={title}
        className="w-[min(440px,calc(100vw-28px))]"
        bodyClassName="p-4"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => restoreDialogFocus(event, returnFocus)}
        onEscapeKeyDown={() => onOpenChange(false)}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="space-y-4"
        >
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            className="h-10 w-full rounded-lg border border-ink-200 bg-paper-50 px-3 text-[13px] text-ink-900 outline-none transition placeholder:text-ink-300 focus:border-ink-300 focus:ring-2 focus:ring-accent-focus"
          />
          <DialogActions>
            <DialogActionButton close>{frontendMessage("ui.cancel")}</DialogActionButton>
            <DialogActionButton type="submit" variant="primary">
              {frontendMessage("session.save")}
            </DialogActionButton>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function ConfirmationDialog({
  intent,
  returnFocus,
  onOpenChange,
}: {
  intent: ConfirmationIntent | null;
  returnFocus: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  return (
    <Dialog open={!!intent} onOpenChange={onOpenChange}>
      <DialogContent
        title={intent?.title ?? ""}
        description={intent?.description}
        className="w-[min(480px,calc(100vw-28px))]"
        bodyClassName="p-4"
        onCloseAutoFocus={(event) => restoreDialogFocus(event, returnFocus)}
        onEscapeKeyDown={() => onOpenChange(false)}
      >
        <div className="rounded-lg border border-ink-200/70 bg-paper-100/70 p-3">
          <div className="flex gap-2.5">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-brick-500" />
            <div className="space-y-1.5">
              {intent?.details.map((detail) => (
                <p key={detail} className="text-[12.5px] leading-5 text-ink-600">
                  {detail}
                </p>
              ))}
            </div>
          </div>
        </div>
        <DialogActions className="mt-4">
          <DialogActionButton close>{frontendMessage("ui.cancel")}</DialogActionButton>
          <DialogActionButton
            onClick={() => {
              intent?.onConfirm();
              onOpenChange(false);
            }}
            variant="danger"
          >
            {intent?.confirmLabel}
          </DialogActionButton>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

function restoreDialogFocus(event: Event, returnFocus: HTMLElement | null): void {
  if (!returnFocus?.isConnected) return;
  event.preventDefault();
  returnFocus.focus();
}
