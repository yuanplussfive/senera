import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Slot } from "@radix-ui/react-slot";
import { type ComponentPropsWithoutRef, type ReactNode, forwardRef } from "react";
import { cn } from "../../lib/util";
import { useOverlayLayer, useOverlayPortalContainer } from "./overlayPortalScope";

export const TooltipProvider = TooltipPrimitive.Provider;

interface TooltipProps extends Omit<ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>, "content" | "asChild"> {
  children: ReactNode;
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  shortcut?: string;
  className?: string;
  delayDuration?: number;
}

export const Tooltip = forwardRef<HTMLButtonElement, TooltipProps>(
  (
    { children, content, side = "bottom", align = "center", shortcut, className, delayDuration = 300, ...triggerProps },
    ref,
  ) => {
    const layer = useOverlayLayer();
    const container = useOverlayPortalContainer();
    if (!content)
      return (
        <Slot {...triggerProps} ref={ref}>
          {children}
        </Slot>
      );
    return (
      <TooltipPrimitive.Root delayDuration={delayDuration}>
        <TooltipPrimitive.Trigger {...triggerProps} asChild ref={ref}>
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal container={container}>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={6}
            collisionPadding={12}
            style={{ zIndex: layer }}
            className={cn(
              "theme-tooltip inline-flex max-w-[min(24rem,calc(100vw-2rem))] items-center gap-2 whitespace-pre-line break-words rounded-lg px-2.5 py-1.5 text-[12px] leading-4",
              "data-[state=delayed-open]:animate-fade-in",
              className,
            )}
          >
            {content}
            {shortcut ? (
              <span className="ml-1 shrink-0 font-mono text-[10.5px] tracking-tight text-content-muted">{shortcut}</span>
            ) : null}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    );
  },
);
Tooltip.displayName = "Tooltip";
