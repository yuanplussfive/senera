import { frontendMessage } from "../../i18n/frontendMessageCatalog";
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
        footerClassName="px-4"
        footer={
          <DialogActions>
            <DialogActionButton close>{frontendMessage("ui.cancel")}</DialogActionButton>
            <DialogActionButton type="submit" form="session-rename-form" variant="primary">
              {frontendMessage("session.save")}
            </DialogActionButton>
          </DialogActions>
        }
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => restoreDialogFocus(event, returnFocus)}
        onEscapeKeyDown={() => onOpenChange(false)}
      >
        <form
          id="session-rename-form"
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
            className="h-10 w-full rounded-lg border border-line bg-surface-panel px-3 text-[13px] text-content-primary outline-none transition placeholder:text-content-muted"
          />
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
        className="w-[min(420px,calc(100vw-28px))]"
        bodyClassName="p-4"
        footerClassName="px-4"
        footer={
          <DialogActions>
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
        }
        onCloseAutoFocus={(event) => restoreDialogFocus(event, returnFocus)}
        onEscapeKeyDown={() => onOpenChange(false)}
      >
        {intent?.details.length ? (
          <div className="rounded-lg border border-line bg-surface-muted p-3">
            <div className="space-y-1.5">
              {intent?.details.map((detail) => (
                <p key={detail} className="text-[12.5px] leading-5 text-content-secondary">
                  {detail}
                </p>
              ))}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function restoreDialogFocus(event: Event, returnFocus: HTMLElement | null): void {
  if (!returnFocus?.isConnected) return;
  event.preventDefault();
  returnFocus.focus();
}
