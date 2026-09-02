import { type ReactNode } from "react";
import { cn } from "../../lib/util";

export const menuSurfaceClassName =
  "menu-surface z-50 min-w-[200px] max-w-[calc(100vw-16px)] overflow-hidden rounded-[var(--menu-surface-radius)] border border-line-subtle bg-surface-panel p-2 shadow-[var(--menu-surface-shadow)]";

export function menuItemClassName({
  className,
  destructive,
  isCoarsePointer,
}: {
  className?: string;
  destructive?: boolean;
  isCoarsePointer: boolean;
}): string {
  return cn(
    "group relative flex min-h-9 cursor-pointer select-none items-center gap-2.5 rounded-[var(--menu-item-radius)] px-2 py-2 text-left text-[14px] leading-5 outline-none",
    "transition-[background-color,color,transform] duration-[var(--menu-item-dur)] ease-[var(--menu-item-ease)] active:scale-[0.985] motion-reduce:active:scale-100",
    isCoarsePointer && "min-h-11",
    "text-content-primary data-[highlighted]:bg-surface-hover/60 data-[highlighted]:text-content-primary",
    destructive && "text-content-secondary data-[highlighted]:bg-surface-hover/60 data-[highlighted]:text-brick-600",
    "data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
    className,
  );
}

export function MenuItemContent({
  children,
  destructive,
  icon,
  shortcut,
}: {
  children: ReactNode;
  destructive?: boolean;
  icon?: ReactNode;
  shortcut?: string;
}): JSX.Element {
  return (
    <>
      {icon ? (
        <span
          className={cn(
            "grid h-[18px] w-[18px] shrink-0 place-items-center text-content-muted transition-colors duration-[var(--menu-item-dur)]",
            "group-data-[highlighted]:text-content-primary",
            destructive && "text-content-muted group-data-[highlighted]:text-brick-600",
          )}
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1 truncate">{children}</div>
      {shortcut ? (
        <span className="ml-3 shrink-0 font-mono text-[10.5px] tracking-tight text-content-muted">{shortcut}</span>
      ) : null}
    </>
  );
}

export const menuSeparatorClassName = "mx-2 my-1 h-px bg-line-subtle";
