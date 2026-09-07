import type { ReactNode } from "react";
import { cn } from "../../lib/util";

export function SettingsControlRow({
  label,
  description,
  control,
  className,
  controlClassName,
  wide = false,
}: {
  label: ReactNode;
  description?: ReactNode;
  control: ReactNode;
  className?: string;
  controlClassName?: string;
  wide?: boolean;
}): JSX.Element {
  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(132px,42%)] items-center gap-x-4 gap-y-2 border-b border-line-subtle px-0 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(220px,320px)] sm:gap-x-8 sm:items-center",
        wide && "sm:grid-cols-[minmax(0,1fr)_minmax(320px,1fr)] sm:items-start",
        className,
      )}
      data-settings-field-row
    >
      <div className="min-w-0">
        <div className="text-[13px] font-medium leading-5 text-content-primary">{label}</div>
        {description ? <div className="mt-1 text-[11.5px] leading-5 text-content-secondary">{description}</div> : null}
      </div>
      <div className={cn("flex min-w-0 w-full justify-end sm:w-full sm:justify-self-end", controlClassName)}>
        {control}
      </div>
    </div>
  );
}

export const settingsSelectClassName =
  "h-9 w-full rounded-md border border-line bg-surface-panel px-3 text-[12.5px] text-content-primary outline-none transition-[background-color,border-color,box-shadow] hover:border-line-strong focus:border-accent-border focus:ring-2 focus:ring-accent-focus disabled:pointer-events-none disabled:opacity-55";
