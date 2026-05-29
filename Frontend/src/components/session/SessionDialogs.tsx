import { CircleAlert } from "lucide-react";
import { cn } from "../../lib/util";
import { Dialog, DialogClose, DialogContent } from "../ui/Dialog";
import type { ConfirmationIntent, LayoutPreferenceId } from "./types";
import { preferenceSections } from "./types";

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
        title="重命名会话"
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
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <button
                type="button"
                className="h-8 rounded-md px-3 text-[12.5px] text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900"
              >
                取消
              </button>
            </DialogClose>
            <button
              type="submit"
              className="h-8 rounded-md bg-ink-900 px-3 text-[12.5px] font-medium text-paper-50 transition hover:bg-ink-800"
            >
              保存
            </button>
          </div>
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
        <div className="mt-4 flex justify-end gap-2">
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
              intent?.onConfirm();
              onOpenChange(false);
            }}
            className={cn(
              "h-8 rounded-md px-3 text-[12.5px] font-medium transition",
              "bg-brick-500 text-paper-50 hover:bg-brick-600",
            )}
          >
            {intent?.confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PreferencesDialog({
  open,
  values,
  onValueChange,
  onOpenChange,
}: {
  open: boolean;
  values: Record<LayoutPreferenceId, boolean>;
  onValueChange: (id: LayoutPreferenceId, value: boolean) => void;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="偏好设置"
        description="这些设置会保存在当前浏览器。"
        className="w-[min(520px,calc(100vw-28px))]"
        bodyClassName="p-4"
      >
        <div className="space-y-4">
          {preferenceSections.map((section) => (
            <section key={section.id}>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-400">
                {section.title}
              </div>
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
        </div>
      </DialogContent>
    </Dialog>
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
      <span
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition",
          checked ? "bg-ink-900" : "bg-ink-200",
        )}
      >
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
