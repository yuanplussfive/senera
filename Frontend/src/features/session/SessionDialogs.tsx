import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { CircleAlert } from "lucide-react";
import { Dialog, DialogActionButton, DialogActions, DialogContent } from "../../shared/ui";
import type { ConfirmationIntent } from "./types";

export function RenameDialog({
  open,
  title,
  value,
  onValueChange,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  value: string;
  onValueChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={frontendMessage("runtime.migrated.features.session.SessionDialogs.23.15")}
        description={title}
        className="w-[min(440px,calc(100vw-28px))]"
        bodyClassName="p-4"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="space-y-4"
        >
          <input
            autoFocus
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            className="h-10 w-full rounded-lg border border-ink-200 bg-paper-50 px-3 text-[13px] text-ink-900 outline-none transition placeholder:text-ink-300 focus:border-ink-300 focus:ring-2 focus:ring-accent-focus"
          />
          <DialogActions>
            <DialogActionButton close>
              {frontendMessage("runtime.migrated.features.session.SessionDialogs.42.39")}
            </DialogActionButton>
            <DialogActionButton type="submit" variant="primary">
              {frontendMessage("runtime.migrated.features.session.SessionDialogs.44.15")}
            </DialogActionButton>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function ConfirmationDialog({
  intent,
  onOpenChange,
}: {
  intent: ConfirmationIntent | null;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  return (
    <Dialog open={!!intent} onOpenChange={onOpenChange}>
      <DialogContent
        title={intent?.title ?? ""}
        description={intent?.description}
        className="w-[min(480px,calc(100vw-28px))]"
        bodyClassName="p-4"
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
          <DialogActionButton close>
            {frontendMessage("runtime.migrated.features.session.SessionDialogs.80.37")}
          </DialogActionButton>
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
