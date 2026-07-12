import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { type ReactNode, forwardRef } from "react";
import { cn } from "../../lib/util";
import { useResponsiveMode } from "../responsive";
import { metaLabelClassName } from "./MetaLabel";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

interface ContentProps extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> {
  className?: string;
}

export const DropdownMenuContent = forwardRef<HTMLDivElement, ContentProps>(
  ({ className, sideOffset = 6, children, ...props }, ref) => (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "scrollbar-thin z-50 min-w-[180px] overflow-hidden rounded-lg border border-ink-200/70 bg-paper-50 p-1 shadow-soft",
          "data-[state=open]:animate-fade-in",
          "data-[side=bottom]:slide-in-from-top-1",
          className,
        )}
        {...props}
      >
        {children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  ),
);
DropdownMenuContent.displayName = "DropdownMenuContent";

interface ItemProps extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> {
  icon?: ReactNode;
  destructive?: boolean;
  shortcut?: string;
}

export const DropdownMenuItem = forwardRef<HTMLDivElement, ItemProps>(
  ({ className, icon, destructive, shortcut, children, ...props }, ref) => {
    const { isCoarsePointer } = useResponsiveMode();

    return (
      <DropdownMenuPrimitive.Item
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
      </DropdownMenuPrimitive.Item>
    );
  },
);
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuSeparator = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator ref={ref} className={cn("my-1 h-px bg-ink-200/60", className)} {...props} />
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";

export const DropdownMenuLabel = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(metaLabelClassName("md", "px-2.5 py-1.5"), className)}
    {...props}
  />
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";

export const DropdownMenuCheckboxItem = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => {
  const { isCoarsePointer } = useResponsiveMode();

  return (
    <DropdownMenuPrimitive.CheckboxItem
      ref={ref}
      checked={checked}
      className={cn(
        "relative flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2.5 pl-7 text-[13px] outline-none",
        isCoarsePointer && "min-h-11",
        "text-ink-800 data-[highlighted]:bg-ink-900/[0.045] data-[highlighted]:text-ink-900",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 grid h-4 w-4 place-items-center text-terra-500">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="h-3.5 w-3.5" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
});
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";
