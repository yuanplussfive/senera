import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { type ReactNode, forwardRef } from "react";
import { cn } from "../../lib/util";
import { useResponsiveMode } from "../responsive";
import { metaLabelClassName } from "./MetaLabel";
import { MenuItemContent, menuItemClassName, menuSeparatorClassName, menuSurfaceClassName } from "./MenuShared";

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuPortal = ContextMenuPrimitive.Portal;

interface ContentProps extends React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content> {
  className?: string;
}

export const ContextMenuContent = forwardRef<HTMLDivElement, ContentProps>(
  ({ className, collisionPadding = 8, children, ...props }, ref) => (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        ref={ref}
        collisionPadding={collisionPadding}
        className={cn(menuSurfaceClassName, "context-menu-surface", className)}
        {...props}
      >
        {children}
      </ContextMenuPrimitive.Content>
    </ContextMenuPrimitive.Portal>
  ),
);
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
        className={menuItemClassName({ className, destructive, isCoarsePointer })}
        {...props}
      >
        <MenuItemContent icon={icon} destructive={destructive} shortcut={shortcut}>
          {children}
        </MenuItemContent>
      </ContextMenuPrimitive.Item>
    );
  },
);
ContextMenuItem.displayName = "ContextMenuItem";

export const ContextMenuSeparator = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator ref={ref} className={cn(menuSeparatorClassName, className)} {...props} />
));
ContextMenuSeparator.displayName = "ContextMenuSeparator";

export const ContextMenuLabel = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Label ref={ref} className={cn(metaLabelClassName("md", "px-2.5 py-2"), className)} {...props} />
));
ContextMenuLabel.displayName = "ContextMenuLabel";
