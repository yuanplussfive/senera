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
            "theme-tooltip z-50 inline-flex max-w-[min(24rem,calc(100vw-2rem))] items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] leading-4",
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
  ),
);
Tooltip.displayName = "Tooltip";
