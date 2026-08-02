import { type ReactNode } from "react";
import { cn } from "../../lib/util";

export const menuSurfaceClassName =
  "menu-surface z-50 min-w-[200px] max-w-[calc(100vw-16px)] overflow-hidden rounded-2xl border border-black/[0.051] bg-white p-2 shadow-[0_4px_16.4px_oklch(0_0_0/0.10)]";

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
    "group relative flex min-h-9 cursor-pointer select-none items-center gap-2.5 rounded-[10px] px-2 py-2 text-left text-[14px] leading-5 text-black/[0.902] outline-none",
    "transition-[background-color,color,transform] duration-[var(--menu-item-dur)]",
    isCoarsePointer && "min-h-11",
    "data-[highlighted]:bg-black/[0.031] data-[highlighted]:text-black/[0.902]",
    "active:scale-[0.985]",
    destructive && "text-black/[0.600] data-[highlighted]:bg-black/[0.031] data-[highlighted]:text-brick-600",
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
            "grid h-[18px] w-[18px] shrink-0 place-items-center text-black/[0.451] transition-colors duration-150",
            "group-data-[highlighted]:text-black/[0.902]",
            destructive && "text-black/[0.451] group-data-[highlighted]:text-brick-600",
          )}
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1 truncate">{children}</div>
      {shortcut ? (
        <span className="ml-3 shrink-0 font-mono text-[10.5px] tracking-tight text-black/[0.302]">{shortcut}</span>
      ) : null}
    </>
  );
}

export const menuSeparatorClassName = "mx-2 my-1 h-px bg-black/[0.129]";
