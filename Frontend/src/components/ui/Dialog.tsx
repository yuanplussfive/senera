import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "../../lib/util";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export const DialogOverlay = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-ink-950/40 backdrop-blur-[1px]",
      "data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = "DialogOverlay";

export const DialogContent = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    title?: string;
    description?: string;
    bodyClassName?: string;
  }
>(({ className, children, title, description, bodyClassName, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Centered modal with a stable max height.
        "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
        "w-[min(720px,calc(100vw-28px))] max-h-[min(720px,calc(100vh-28px))]",
        "flex flex-col overflow-hidden rounded-xl border border-ink-200/80 bg-paper-50 shadow-soft",
        "data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out",
        className,
      )}
      {...props}
    >
      <div className="flex items-start gap-3 border-b border-ink-200/70 bg-paper-50 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <DialogPrimitive.Title className="truncate text-[13.5px] font-medium text-ink-900">
            {title ?? ""}
          </DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="mt-0.5 truncate text-[12px] text-ink-500">
              {description}
            </DialogPrimitive.Description>
          ) : null}
        </div>
        <DialogClose asChild>
          <button
            type="button"
            className={cn(
              "grid h-8 w-8 flex-shrink-0 place-items-center rounded-md text-ink-500 transition",
              "hover:bg-ink-900/[0.05] hover:text-ink-800",
              "focus:outline-none focus:ring-2 focus:ring-terra-200/60",
            )}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </DialogClose>
      </div>
      <div className={bodyClassName}>{children}</div>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = "DialogContent";
