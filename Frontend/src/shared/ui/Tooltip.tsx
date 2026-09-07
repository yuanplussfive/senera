import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { type ReactNode, forwardRef } from "react";
import { cn } from "../../lib/util";

export const TooltipProvider = TooltipPrimitive.Provider;

interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  shortcut?: string;
  className?: string;
  delayDuration?: number;
}

export const Tooltip = forwardRef<HTMLButtonElement, TooltipProps>(
  ({ children, content, side = "bottom", align = "center", shortcut, className, delayDuration = 300 }, _ref) => (
    <TooltipPrimitive.Root delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          className={cn(
            "theme-tooltip z-50 inline-flex items-center gap-2 rounded-md px-2 py-1 text-[11.5px]",
            "data-[state=delayed-open]:animate-fade-in",
            className,
          )}
        >
          {content}
          {shortcut ? <span className="font-mono text-[10px] opacity-70">{shortcut}</span> : null}
          <TooltipPrimitive.Arrow className="theme-tooltip__arrow" width={8} height={4} />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  ),
);
Tooltip.displayName = "Tooltip";
