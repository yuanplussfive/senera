import { AlertTriangle } from "lucide-react";
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
        <div className="flex items-start gap-3 border-l-2 border-brick-300 py-1 pl-3 text-[12.5px] leading-5 text-ink-600">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brick-600" />
          <span>{consequence}</span>
        </div>
        <DialogActions className="mt-6">
          <DialogActionButton close autoFocus>
            {continueLabel}
          </DialogActionButton>
          <DialogActionButton variant="danger" onClick={onDiscard}>
            {confirmLabel}
          </DialogActionButton>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
