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

function dropdownTransformOrigin(side: "top" | "right" | "bottom" | "left" | undefined, align: "start" | "center" | "end" | undefined): string {
  const horizontalOrigin =
    side === "left" ? "100%" : side === "right" ? "0%" : align === "start" ? "0%" : align === "end" ? "100%" : "50%";
  const verticalOrigin =
    side === "top" ? "100%" : side === "bottom" ? "0%" : align === "start" ? "0%" : align === "end" ? "100%" : "50%";
  return `${horizontalOrigin} ${verticalOrigin}`;
}

interface ContentProps extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> {
  className?: string;
}

export const DropdownMenuContent = forwardRef<HTMLDivElement, ContentProps>(
  ({ className, side = "bottom", align = "center", sideOffset = 6, collisionPadding = 8, children, ...props }, ref) => (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        style={{ transformOrigin: dropdownTransformOrigin(side, align) }}
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
        "flex min-h-9 items-center gap-2.5 rounded-[10px] px-2 py-2 text-[13px] leading-5 text-black/[0.600]",
        className,
      )}
      {...props}
    >
      {icon ? <span className="grid h-[18px] w-[18px] shrink-0 place-items-center text-black/[0.451]">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {value ? <span className="shrink-0 text-[11px] text-black/[0.302]">{value}</span> : null}
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
        "group relative flex min-h-9 cursor-pointer select-none items-center gap-2.5 rounded-[10px] px-2 py-2 text-left text-[14px] leading-5 text-black/[0.902] outline-none",
        "transition-[background-color,color,transform] duration-[var(--menu-item-dur)]",
        isCoarsePointer && "min-h-11",
        "data-[highlighted]:bg-black/[0.031] active:scale-[0.985]",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
        className,
      )}
      {...props}
    >
      <span className="grid h-[18px] w-[18px] shrink-0 place-items-center">
        <DropdownMenuPrimitive.ItemIndicator asChild>
          <Check className="menu-check h-4 w-4 text-[oklch(0.6234_0.2055_256.39)]" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </DropdownMenuPrimitive.CheckboxItem>
  );
});
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";
