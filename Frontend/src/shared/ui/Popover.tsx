import * as PopoverPrimitive from "@radix-ui/react-popover";
import { OverlayLayerScope, useOverlayLayer, useOverlayPortalContainer } from "./overlayPortalScope";
import { forwardRef } from "react";
import { cn } from "../../lib/util";
import { overlaySurfaceClassName } from "./MenuShared";
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

interface PopoverContentProps extends React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> {
  className?: string;
}

export const PopoverContent = forwardRef<HTMLDivElement, PopoverContentProps>(
  (
    { className, align = "start", side = "bottom", sideOffset = 6, collisionPadding = 12, style, children, ...props },
    ref,
  ) => {
    const layer = useOverlayLayer();
    return (
      <PopoverPrimitive.Portal container={useOverlayPortalContainer()}>
        <PopoverPrimitive.Content
          ref={ref}
          align={align}
          side={side}
          sideOffset={sideOffset}
          collisionPadding={collisionPadding}
          style={{ ...style, zIndex: layer }}
          className={cn(
            "max-h-[min(35rem,calc(100dvh-5rem))] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface-panel p-3 shadow-soft outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
            className,
          )}
          {...props}
        >
          <OverlayLayerScope.Provider value={layer + 1}>{children}</OverlayLayerScope.Provider>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    );
  },
);
PopoverContent.displayName = "PopoverContent";
