import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { type HTMLAttributes, type ReactNode, forwardRef } from "react";
import { cn } from "../../lib/util";
import { useResponsiveMode } from "../responsive";
import { AppIcon } from "./AppIcon";
import { metaLabelClassName } from "./MetaLabel";
import { MenuItemContent, menuItemClassName, menuSeparatorClassName, menuSurfaceClassName } from "./MenuShared";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

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
        className={cn(menuSurfaceClassName, "dropdown-menu-surface", className)}
        {...props}
      >
        {children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  ),
);
DropdownMenuContent.displayName = "DropdownMenuContent";

interface SubTriggerProps extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> {
  icon?: ReactNode;
}

export const DropdownMenuSubTrigger = forwardRef<HTMLDivElement, SubTriggerProps>(
  ({ className, icon, children, ...props }, ref) => {
    const { isCoarsePointer } = useResponsiveMode();

    return (
      <DropdownMenuPrimitive.SubTrigger
        ref={ref}
        className={menuItemClassName({ className, isCoarsePointer })}
        {...props}
      >
        {icon ? (
          <span className="grid h-[18px] w-[18px] shrink-0 place-items-center text-content-muted">{icon}</span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{children}</span>
        <AppIcon
          icon="chevron-right"
          className="h-3.5 w-3.5 shrink-0 text-content-muted transition-colors duration-[var(--menu-item-dur)] group-data-[highlighted]:text-content-primary"
          aria-hidden="true"
        />
      </DropdownMenuPrimitive.SubTrigger>
    );
  },
);
DropdownMenuSubTrigger.displayName = "DropdownMenuSubTrigger";

interface SubContentProps extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent> {
  className?: string;
}

export const DropdownMenuSubContent = forwardRef<HTMLDivElement, SubContentProps>(
  ({ className, sideOffset = 12, alignOffset = -4, collisionPadding = 8, children, ...props }, ref) => (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent
        ref={ref}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
        className={cn(menuSurfaceClassName, "dropdown-menu-surface", className)}
        {...props}
      >
        {children}
      </DropdownMenuPrimitive.SubContent>
    </DropdownMenuPrimitive.Portal>
  ),
);
DropdownMenuSubContent.displayName = "DropdownMenuSubContent";

interface ItemProps extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> {
  icon?: ReactNode;
  destructive?: boolean;
  shortcut?: string;
  trailing?: ReactNode;
}

export const DropdownMenuItem = forwardRef<HTMLDivElement, ItemProps>(
  ({ className, icon, destructive, shortcut, trailing, children, ...props }, ref) => {
    const { isCoarsePointer } = useResponsiveMode();

    return (
      <DropdownMenuPrimitive.Item
        ref={ref}
        className={menuItemClassName({ className, destructive, isCoarsePointer })}
        {...props}
      >
        <MenuItemContent icon={icon} destructive={destructive} shortcut={shortcut} trailing={trailing}>
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
        "flex min-h-9 items-center gap-2.5 rounded-[var(--menu-item-radius)] px-2 py-2 text-[13px] leading-5 text-content-secondary",
        className,
      )}
      {...props}
    >
      {icon ? (
        <span className="grid h-[18px] w-[18px] shrink-0 place-items-center text-content-muted">{icon}</span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {value ? <span className="shrink-0 text-[11px] text-content-muted">{value}</span> : null}
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
      className={menuItemClassName({ className, isCoarsePointer })}
      {...props}
    >
      <span className="grid h-[18px] w-[18px] shrink-0 place-items-center">
        <DropdownMenuPrimitive.ItemIndicator forceMount asChild>
          <AppIcon icon="check" size={16} className="menu-check text-accent-content" aria-hidden="true" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </DropdownMenuPrimitive.CheckboxItem>
  );
});
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";

export const DropdownMenuRadioItem = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, value, ...props }, ref) => {
  const { isCoarsePointer } = useResponsiveMode();

  return (
    <DropdownMenuPrimitive.RadioItem
      ref={ref}
      value={value}
      className={menuItemClassName({ className, isCoarsePointer })}
      {...props}
    >
      <span className="grid h-[18px] w-[18px] shrink-0 place-items-center">
        <DropdownMenuPrimitive.ItemIndicator asChild>
          <AppIcon icon="check" size={16} className="menu-check text-accent-content" aria-hidden="true" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </DropdownMenuPrimitive.RadioItem>
  );
});
DropdownMenuRadioItem.displayName = "DropdownMenuRadioItem";
