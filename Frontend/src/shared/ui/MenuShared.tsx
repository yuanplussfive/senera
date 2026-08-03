import { type ReactNode } from "react";
import { cn } from "../../lib/util";

export const menuSurfaceClassName =
  "menu-surface z-50 min-w-[200px] max-w-[calc(100vw-16px)] overflow-hidden rounded-lg border border-line bg-surface-panel p-1.5 shadow-soft";

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
    "group flex min-h-10 cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] leading-5 outline-none",
    "transition-[background-color,color] duration-100",
    isCoarsePointer && "min-h-11",
    "text-content-primary data-[highlighted]:bg-accent-surface data-[highlighted]:text-accent-content",
    destructive && "text-content-secondary data-[highlighted]:bg-surface-hover data-[highlighted]:text-brick-600",
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
            "grid h-4 w-4 shrink-0 place-items-center text-content-muted transition-colors duration-100",
            "group-data-[highlighted]:text-accent-content",
            destructive && "text-content-muted group-data-[highlighted]:text-brick-600",
          )}
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1 truncate">{children}</div>
      {shortcut ? (
        <span className="ml-3 shrink-0 font-mono text-[10.5px] tracking-tight text-ink-400">{shortcut}</span>
      ) : null}
    </>
  );
}

export const menuSeparatorClassName = "mx-2.5 my-1 h-px bg-line-subtle";
