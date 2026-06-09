import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "../../lib/util";
import { MotionDialogOverlay, MotionSheetContent } from "../motion";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

export const SheetOverlay = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    asChild
    forceMount
    {...props}
  >
    <MotionDialogOverlay
    className={cn(
      "fixed inset-0 z-50 bg-ink-950/35 backdrop-blur-[1px]",
      className,
    )}
    />
  </DialogPrimitive.Overlay>
));
SheetOverlay.displayName = "SheetOverlay";

type SheetSide = "left" | "right";

const sideClasses: Record<SheetSide, string> = {
  left: "left-0 border-r",
  right: "right-0 border-l",
};

export interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: SheetSide;
  title?: string;
  description?: string;
  overlayClassName?: string;
  focusContentOnOpen?: boolean;
  showClose?: boolean;
  showHeader?: boolean;
}

export const SheetContent = forwardRef<HTMLDivElement, SheetContentProps>(
  ({
    side = "right",
    className,
    children,
    title,
    description,
    overlayClassName,
    focusContentOnOpen = false,
    showClose = true,
    showHeader = true,
    onOpenAutoFocus,
    ...props
  }, ref) => (
    <SheetPortal>
      <SheetOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        ref={ref}
        asChild
        forceMount
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event);
          if (event.defaultPrevented || !focusContentOnOpen) return;
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus({ preventScroll: true });
        }}
        {...(!description ? { "aria-describedby": undefined } : {})}
        {...props}
      >
        <MotionSheetContent
          side={side}
        className={cn(
          "fixed top-0 z-50 flex h-full w-[min(360px,calc(100vw-24px))] flex-col overflow-hidden",
          "border-ink-200 bg-paper-50 shadow-soft outline-none",
          sideClasses[side],
          className,
        )}
      >
        {showHeader && (title || showClose) ? (
          <div className="flex min-h-14 items-start gap-3 border-b border-ink-200/70 bg-paper-50 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              {title ? (
                <DialogPrimitive.Title className="truncate text-[13.5px] font-medium text-ink-900">
                  {title}
                </DialogPrimitive.Title>
              ) : null}
              {description ? (
                <DialogPrimitive.Description className="mt-0.5 truncate text-[12px] text-ink-500">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            {showClose ? (
              <DialogPrimitive.Close asChild>
                <button
                  type="button"
                  className={cn(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-500 transition",
                    "hover:bg-ink-900/[0.05] hover:text-ink-800",
                    "focus:outline-none focus:ring-2 focus:ring-terra-200/60",
                  )}
                  aria-label="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </DialogPrimitive.Close>
            ) : null}
          </div>
        ) : (
          <>
            {title ? <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title> : null}
            {description ? (
              <DialogPrimitive.Description className="sr-only">{description}</DialogPrimitive.Description>
            ) : null}
          </>
        )}
        {children}
        </MotionSheetContent>
      </DialogPrimitive.Content>
    </SheetPortal>
  ),
);
SheetContent.displayName = "SheetContent";
