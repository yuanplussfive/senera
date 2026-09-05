import { AlertTriangle, Undo2, X } from "lucide-react";
import { Dialog, DialogActionButton, DialogActions, DialogContent } from "../../shared/ui";

export function DiscardDraftDialog({
  confirmLabel,
  consequence,
  continueLabel,
  description,
  open,
  title,
  onDiscard,
  onOpenChange,
}: {
  confirmLabel: string;
  consequence: string;
  continueLabel: string;
  description: string;
  open: boolean;
  title: string;
  onDiscard: () => void;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        description={description}
        showClose={false}
        className="w-[min(500px,calc(100vw_-_32px))]"
        bodyClassName="px-8 pb-7 pt-1"
      >
        <div className="flex items-start gap-2.5 py-1 text-[12.5px] leading-5 text-ink-600">
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brick-50 text-brick-600">
            <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
          </span>
          <span>{consequence}</span>
        </div>
        <DialogActions className="mt-6">
          <DialogActionButton close autoFocus>
            <Undo2 aria-hidden="true" className="h-3.5 w-3.5" />
            {continueLabel}
          </DialogActionButton>
          <DialogActionButton variant="danger" onClick={onDiscard}>
            <X aria-hidden="true" className="h-3.5 w-3.5" />
            {confirmLabel}
          </DialogActionButton>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
