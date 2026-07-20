import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { type HTMLAttributes, type ReactNode, forwardRef } from "react";
import { cn } from "../../lib/util";
import { useResponsiveMode } from "../responsive";
import { metaLabelClassName } from "./MetaLabel";
import { MenuItemContent, menuItemClassName, menuSeparatorClassName, menuSurfaceClassName } from "./MenuShared";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

interface ContentProps extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> {
  className?: string;
}

export const DropdownMenuContent = forwardRef<HTMLDivElement, ContentProps>(
  ({ className, sideOffset = 6, collisionPadding = 8, children, ...props }, ref) => (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(menuSurfaceClassName, "dropdown-menu-surface", className)}
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
        className={menuItemClassName({ className, destructive, isCoarsePointer })}
        {...props}
      >
        <MenuItemContent icon={icon} destructive={destructive} shortcut={shortcut}>
          {children}
        </MenuItemContent>
      </DropdownMenuPrimitive.Item>
    );
  },
);
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuSeparator = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator ref={ref} className={cn(menuSeparatorClassName, className)} {...props} />
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";

export const DropdownMenuLabel = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(metaLabelClassName("md", "px-2.5 py-2"), className)}
    {...props}
  />
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";

interface MetaProps extends HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode;
  value?: ReactNode;
}

export const DropdownMenuMeta = forwardRef<HTMLDivElement, MetaProps>(
  ({ className, icon, value, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex min-h-10 items-center gap-2.5 rounded-md px-2.5 py-2 text-[12px] leading-5 text-ink-500",
        className,
      )}
      {...props}
    >
      {icon ? <span className="grid h-4 w-4 shrink-0 place-items-center text-ink-450">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {value ? <span className="shrink-0 text-[11px] text-ink-400">{value}</span> : null}
    </div>
  ),
);
DropdownMenuMeta.displayName = "DropdownMenuMeta";

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
        "relative flex min-h-10 cursor-pointer select-none items-center rounded-md px-2.5 py-2 pl-8 text-[13px] leading-5 outline-none",
        "transition-[background-color,color] duration-100",
        isCoarsePointer && "min-h-11",
        "text-content-primary data-[highlighted]:bg-accent-surface data-[highlighted]:text-accent-content",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2.5 grid h-4 w-4 place-items-center text-accent-content">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="h-3.5 w-3.5" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </DropdownMenuPrimitive.CheckboxItem>
  );
});
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";
