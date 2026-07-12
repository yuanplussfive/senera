import { Check, CircleAlert } from "lucide-react";
import { cn } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Dialog, DialogActionButton, DialogActions, DialogContent, MetaLabel } from "../../shared/ui";
import type { MotionLevel } from "../../shared/motion";
import type { ConfirmationIntent, LayoutPreferenceId } from "./types";
import { motionLevelOptions, preferenceSections } from "./types";

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
        title={frontendMessage("session.renameDialogTitle")}
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
            className="h-10 w-full rounded-lg border border-ink-200 bg-paper-50 px-3 text-[13px] text-ink-900 outline-none transition placeholder:text-ink-300 focus:border-ink-300 focus:ring-2 focus:ring-terra-200/50"
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

export function PreferencesDialog({
  open,
  values,
  motionLevel,
  onValueChange,
  onMotionLevelChange,
  onOpenChange,
}: {
  open: boolean;
  values: Record<LayoutPreferenceId, boolean>;
  motionLevel: MotionLevel;
  onValueChange: (id: LayoutPreferenceId, value: boolean) => void;
  onMotionLevelChange: (level: MotionLevel) => void;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={frontendMessage("session.preferences")}
        description={frontendMessage("preferences.description")}
        className="w-[min(520px,calc(100vw-28px))]"
        bodyClassName="p-4"
      >
        <div className="space-y-4">
          {preferenceSections.map((section) => (
            <section key={section.id}>
              <MetaLabel as="div" size="sm" className="mb-2">
                {section.title}
              </MetaLabel>
              <div className="overflow-hidden rounded-lg border border-ink-200/70 bg-paper-50">
                {section.items.map((item, index) => (
                  <PreferenceToggle
                    key={item.id}
                    title={item.title}
                    description={item.description}
                    checked={values[item.id]}
                    separated={index > 0}
                    onCheckedChange={(checked) => onValueChange(item.id, checked)}
                  />
                ))}
              </div>
            </section>
          ))}
          <section>
            <MetaLabel as="div" size="sm" className="mb-2">
              {frontendMessage("preferences.motion")}
            </MetaLabel>
            <div className="grid grid-cols-3 gap-1.5 rounded-lg border border-ink-200/70 bg-paper-50 p-1">
              {motionLevelOptions.map((option) => (
                <MotionLevelOption
                  key={option.id}
                  title={option.title}
                  description={option.description}
                  selected={motionLevel === option.id}
                  onSelect={() => onMotionLevelChange(option.id)}
                />
              ))}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MotionLevelOption({
  title,
  description,
  selected,
  onSelect,
}: {
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex min-w-0 flex-col rounded-md border px-2.5 py-2 text-left transition",
        "hover:border-ink-300 hover:bg-ink-900/[0.035]",
        selected ? "border-ink-900 bg-ink-900/[0.04]" : "border-transparent",
      )}
      aria-pressed={selected}
    >
      <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-900">
        {title}
        {selected ? <Check className="h-3.5 w-3.5 text-terra-500" /> : null}
      </span>
      <span className="mt-1 text-[11px] leading-4 text-ink-500">{description}</span>
    </button>
  );
}

function PreferenceToggle({
  title,
  description,
  checked,
  separated,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  separated?: boolean;
  onCheckedChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-ink-900/[0.035]",
        separated && "border-t border-ink-200/60",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-ink-900">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-5 text-ink-500">{description}</span>
      </span>
      <span className={cn("relative h-5 w-9 shrink-0 rounded-full transition", checked ? "bg-ink-900" : "bg-ink-200")}>
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-paper-50 shadow-sm transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
