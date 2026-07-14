import { AlertTriangle, BadgeCheck, FileUp, X } from "lucide-react";
import { cn } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Button, IconButton } from "../../shared/ui";

export type PresetConfirmAction = {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "primary";
  onConfirm: () => void;
};

export function ConfirmLayer({
  action,
  onCancel,
  onConfirm,
}: {
  action: PresetConfirmAction;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-ink-950/32 p-4">
      <div className="w-full max-w-sm rounded-lg border border-ink-200 bg-paper-50 p-4 shadow-soft">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
              action.tone === "danger" ? "bg-brick-50 text-brick-600" : "bg-terra-50 text-terra-700",
            )}
          >
            {action.tone === "danger" ? <AlertTriangle className="h-4 w-4" /> : <BadgeCheck className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-ink-900">{action.title}</div>
            <div className="mt-1 break-words text-[12px] leading-5 text-ink-500">{action.description}</div>
          </div>
          <IconButton label={frontendMessage("ui.cancel")} size="sm" tone="muted" onClick={onCancel}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {frontendMessage("ui.cancel")}
          </Button>
          <Button size="sm" variant={action.tone === "danger" ? "destructive" : "default"} onClick={onConfirm}>
            {action.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DropOverlay({ rejected }: { rejected: boolean }): JSX.Element {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-lg border border-dashed bg-paper-50 text-[13px] font-medium shadow-soft",
        rejected ? "border-brick-300 text-brick-700" : "border-terra-300 text-terra-700",
      )}
    >
      <span className="inline-flex items-center gap-2">
        <FileUp className="h-4 w-4" />
        {frontendMessage(rejected ? "preset.ui.dropRejected" : "preset.ui.dropImport")}
      </span>
    </div>
  );
}
