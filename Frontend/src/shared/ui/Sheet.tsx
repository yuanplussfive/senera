import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { forwardRef, useRef, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/util";
import { dialogPresenceExitMs, MotionDialogOverlay, MotionSheetContent } from "../motion";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

type SheetPresenceStyle = CSSProperties & {
  "--dialog-presence-exit-dur"?: string;
};

const sheetPresenceStyle = {
  "--dialog-presence-exit-dur": `${dialogPresenceExitMs}ms`,
} satisfies SheetPresenceStyle;

function mergeSheetPresenceStyle(style?: CSSProperties): SheetPresenceStyle {
  return style ? { ...sheetPresenceStyle, ...style } : sheetPresenceStyle;
}

export const SheetOverlay = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, style, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    asChild
    forceMount
    {...props}
  >
    <MotionDialogOverlay
      className={cn(
        "dialog-presence fixed inset-0 z-50 bg-ink-950/35 backdrop-blur-[1px]",
        className,
      )}
      style={mergeSheetPresenceStyle(style)}
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

type SheetContentSnapshot = {
  children: ReactNode;
  className?: string;
  description?: string;
  showClose: boolean;
  showHeader: boolean;
  side: SheetSide;
  title?: string;
};

type SheetContentFrameProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  | "children"
  | "className"
  | "onAnimationStart"
  | "onDrag"
  | "onDragEnd"
  | "onDragStart"
  | "style"
  | "title"
> & SheetContentSnapshot & {
  "data-state"?: string;
  style?: CSSProperties;
};

const SheetContentFrame = forwardRef<
  HTMLDivElement,
  SheetContentFrameProps
>(({
  children,
  className,
  description,
  showClose,
  showHeader,
  side,
  style,
  title,
  "data-state": dataState,
  ...props
}, ref) => {
  const liveContent: SheetContentSnapshot = {
    children,
    className,
    description,
    showClose,
    showHeader,
    side,
    title,
  };
  const openContentRef = useRef(liveContent);
  if (dataState !== "closed") {
    openContentRef.current = liveContent;
  }
  const content = dataState === "closed" ? openContentRef.current : liveContent;

  return (
    <MotionSheetContent
      ref={ref}
      side={content.side}
      className={cn(
        "dialog-presence",
        "fixed top-0 z-50 flex h-full w-[min(360px,calc(100vw-24px))] flex-col overflow-hidden",
        "border-ink-200 bg-paper-50 shadow-soft outline-none",
        sideClasses[content.side],
        content.className,
      )}
      data-state={dataState}
      style={mergeSheetPresenceStyle(style)}
      {...props}
    >
      {content.showHeader && (content.title || content.showClose) ? (
        <div className="flex min-h-14 items-start gap-3 border-b border-ink-200/70 bg-paper-50 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            {content.title ? (
              <DialogPrimitive.Title className="truncate text-[13.5px] font-medium text-ink-900">
                {content.title}
              </DialogPrimitive.Title>
            ) : null}
            {content.description ? (
              <DialogPrimitive.Description className="mt-0.5 truncate text-[12px] text-ink-500">
                {content.description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          {content.showClose ? (
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
          {content.title ? <DialogPrimitive.Title className="sr-only">{content.title}</DialogPrimitive.Title> : null}
          {content.description ? (
            <DialogPrimitive.Description className="sr-only">{content.description}</DialogPrimitive.Description>
          ) : null}
        </>
      )}
      {content.children}
    </MotionSheetContent>
  );
});
SheetContentFrame.displayName = "SheetContentFrame";

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
    style,
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
        <SheetContentFrame
          side={side}
          className={className}
          description={description}
          showClose={showClose}
          showHeader={showHeader}
          style={style}
          title={title}
        >
          {children}
        </SheetContentFrame>
      </DialogPrimitive.Content>
    </SheetPortal>
  ),
);
SheetContent.displayName = "SheetContent";
