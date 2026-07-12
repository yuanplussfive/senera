import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { type ReactNode, forwardRef } from "react";
import { cn } from "../../lib/util";
import { useResponsiveMode } from "../responsive";
import { metaLabelClassName } from "./MetaLabel";

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuPortal = ContextMenuPrimitive.Portal;

interface ContentProps extends React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content> {
  className?: string;
}

export const ContextMenuContent = forwardRef<HTMLDivElement, ContentProps>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={cn(
        "z-50 min-w-[180px] overflow-hidden rounded-lg border border-ink-200/70 bg-paper-50 p-1 shadow-soft",
        "data-[state=open]:animate-fade-in",
        className,
      )}
      {...props}
    >
      {children}
    </ContextMenuPrimitive.Content>
  </ContextMenuPrimitive.Portal>
));
ContextMenuContent.displayName = "ContextMenuContent";

interface ItemProps extends React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> {
  icon?: ReactNode;
  destructive?: boolean;
  shortcut?: string;
}

export const ContextMenuItem = forwardRef<HTMLDivElement, ItemProps>(
  ({ className, icon, destructive, shortcut, children, ...props }, ref) => {
    const { isCoarsePointer } = useResponsiveMode();

    return (
      <ContextMenuPrimitive.Item
        ref={ref}
        className={cn(
          "group flex h-8 cursor-default select-none items-center gap-2.5 rounded-md px-2.5 text-[13px] outline-none transition-colors",
          isCoarsePointer && "min-h-11",
          "text-ink-800 data-[highlighted]:bg-ink-900/[0.045] data-[highlighted]:text-ink-900",
          destructive && "text-brick-500 data-[highlighted]:bg-brick-50 data-[highlighted]:text-brick-600",
          "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
          className,
        )}
        {...props}
      >
        {icon ? (
          <span className="grid h-4 w-4 place-items-center text-ink-500 group-data-[highlighted]:text-ink-800">
            {icon}
          </span>
        ) : null}
        <span className="flex-1 truncate">{children}</span>
        {shortcut ? <span className="ml-3 text-[10.5px] font-mono tracking-tight text-ink-400">{shortcut}</span> : null}
      </ContextMenuPrimitive.Item>
    );
  },
);
ContextMenuItem.displayName = "ContextMenuItem";

export const ContextMenuSeparator = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator ref={ref} className={cn("my-1 h-px bg-ink-200/60", className)} {...props} />
));
ContextMenuSeparator.displayName = "ContextMenuSeparator";

export const ContextMenuLabel = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    className={cn(metaLabelClassName("md", "px-2.5 py-1.5"), className)}
    {...props}
  />
));
ContextMenuLabel.displayName = "ContextMenuLabel";
