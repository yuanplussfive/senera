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
        className="w-[min(420px,calc(100vw-28px))]"
        bodyClassName="px-6 pb-4 pt-1"
        footerClassName="px-6 pb-5"
        footer={
          <DialogActions>
            <DialogActionButton close autoFocus>
              {continueLabel}
            </DialogActionButton>
            <DialogActionButton variant="danger" onClick={onDiscard}>
              {confirmLabel}
            </DialogActionButton>
          </DialogActions>
        }
      >
        <div className="rounded-lg border border-line bg-surface-muted px-3 py-2.5 text-[12.5px] leading-5 text-content-secondary">
          <span>{consequence}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
