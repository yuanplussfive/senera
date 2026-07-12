import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ForwardedRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { Transition, VariantLabels, Variants } from "framer-motion";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { dialogPresenceExitMs, MotionDialogContent, MotionDialogOverlay, type DialogMotionPreset } from "../motion";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

type DialogPresenceStyle = CSSProperties & {
  "--dialog-presence-exit-dur"?: string;
};

type DialogDragOffset = {
  x: number;
  y: number;
};

type DialogDragState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startOffset: DialogDragOffset;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export interface DialogDragBoundsInput {
  edgePadding: number;
  rect: Pick<DOMRect, "bottom" | "left" | "right" | "top">;
  startOffset: DialogDragOffset;
  viewportHeight: number;
  viewportWidth: number;
}

const dialogPresenceStyle = {
  "--dialog-presence-exit-dur": `${dialogPresenceExitMs}ms`,
} satisfies DialogPresenceStyle;

function mergeDialogPresenceStyle(style?: CSSProperties): DialogPresenceStyle {
  return style ? { ...dialogPresenceStyle, ...style } : dialogPresenceStyle;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function readDialogDragBounds({
  edgePadding,
  rect,
  startOffset,
  viewportHeight,
  viewportWidth,
}: DialogDragBoundsInput): Pick<DialogDragState, "maxX" | "maxY" | "minX" | "minY"> {
  return {
    minX: edgePadding - rect.left + startOffset.x,
    maxX: viewportWidth - edgePadding - rect.right + startOffset.x,
    minY: edgePadding - rect.top + startOffset.y,
    maxY: viewportHeight - edgePadding - rect.bottom + startOffset.y,
  };
}

export function clampDialogDragOffset(
  offset: DialogDragOffset,
  bounds: Pick<DialogDragState, "maxX" | "maxY" | "minX" | "minY">,
): DialogDragOffset {
  return {
    x: clamp(offset.x, bounds.minX, bounds.maxX),
    y: clamp(offset.y, bounds.minY, bounds.maxY),
  };
}

function canDragDialog(event: ReactPointerEvent): boolean {
  if (event.button !== 0) return false;
  if (event.pointerType === "touch") return false;
  return true;
}

function isZeroOffset(offset: DialogDragOffset): boolean {
  return offset.x === 0 && offset.y === 0;
}

function setForwardedRef<T>(ref: ForwardedRef<T>, value: T | null): void {
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  if (ref) {
    ref.current = value;
  }
}

export const DialogOverlay = forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>>(
  ({ className, style, ...props }, ref) => (
    <DialogPrimitive.Overlay ref={ref} asChild forceMount {...props}>
      <MotionDialogOverlay
        className={cn("dialog-presence fixed inset-0 z-50 bg-ink-950/34 [will-change:opacity]", className)}
        style={mergeDialogPresenceStyle(style)}
      />
    </DialogPrimitive.Overlay>
  ),
);
DialogOverlay.displayName = "DialogOverlay";

type DialogContentSnapshot = {
  bodyClassName?: string;
  children: ReactNode;
  contentInitial?: false | VariantLabels;
  contentTransition?: Transition;
  contentVariants?: Variants;
  description?: string;
  draggable: boolean;
  motionPreset: DialogMotionPreset;
  panelClassName?: string;
  title?: string;
};

const DialogContentFrame = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div"> & {
    title?: string;
    description?: string;
    bodyClassName?: string;
    frameClassName?: string;
    panelClassName?: string;
    draggable?: boolean;
    motionPreset: DialogMotionPreset;
    contentInitial?: false | VariantLabels;
    contentVariants?: Variants;
    contentTransition?: Transition;
    "data-state"?: string;
  }
>(
  (
    {
      className,
      children,
      title,
      description,
      bodyClassName,
      frameClassName: _frameClassName,
      panelClassName,
      draggable = true,
      motionPreset,
      contentInitial,
      contentVariants,
      contentTransition,
      style,
      "data-state": dataState,
      ...props
    },
    ref,
  ) => {
    const frameRef = useRef<HTMLDivElement | null>(null);
    const dragStateRef = useRef<DialogDragState | null>(null);
    const [dragOffset, setDragOffset] = useState<DialogDragOffset>({ x: 0, y: 0 });
    const liveContent: DialogContentSnapshot = {
      bodyClassName,
      children,
      contentInitial,
      contentTransition,
      contentVariants,
      description,
      draggable,
      motionPreset,
      panelClassName,
      title,
    };
    const openContentRef = useRef(liveContent);
    if (dataState !== "closed") {
      openContentRef.current = liveContent;
    }
    const content = dataState === "closed" ? openContentRef.current : liveContent;
    const canShowDragCursor = content.draggable && dataState !== "closed";
    const baseFrameStyle = isZeroOffset(dragOffset)
      ? style
      : { ...(style ?? {}), translate: `${dragOffset.x}px ${dragOffset.y}px` };
    const frameStyle = mergeDialogPresenceStyle(
      dataState === "closed" ? { ...(baseFrameStyle ?? {}), pointerEvents: "none" } : baseFrameStyle,
    );

    useEffect(() => {
      if (dataState === "closed") {
        setDragOffset({ x: 0, y: 0 });
        dragStateRef.current = null;
      }
    }, [dataState]);

    const setFrameNode = (node: HTMLDivElement | null): void => {
      frameRef.current = node;
      setForwardedRef(ref, node);
    };

    const handleHeaderPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (!content.draggable || dataState === "closed" || !canDragDialog(event)) {
        return;
      }
      const frame = frameRef.current;
      if (!frame) return;

      const rect = frame.getBoundingClientRect();
      const edgePadding = 12;
      const startOffset = dragOffset;
      const bounds = readDialogDragBounds({
        edgePadding,
        rect,
        startOffset,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      });
      dragStateRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startOffset,
        ...bounds,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    };

    const handleHeaderPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      const nextX = dragState.startOffset.x + event.clientX - dragState.startClientX;
      const nextY = dragState.startOffset.y + event.clientY - dragState.startClientY;
      setDragOffset(clampDialogDragOffset({ x: nextX, y: nextY }, dragState));
    };

    const stopDragging = (event: ReactPointerEvent<HTMLDivElement>): void => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      dragStateRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    };

    return (
      <div ref={setFrameNode} className={className} data-state={dataState} style={frameStyle} {...props}>
        <MotionDialogContent
          className={content.panelClassName}
          data-dialog-panel="true"
          data-state={dataState}
          motionPreset={content.motionPreset}
          initial={content.contentInitial}
          variants={content.contentVariants}
          transition={content.contentTransition}
        >
          <div
            className={cn(
              "flex items-start gap-3 border-b border-ink-200/50 bg-paper-50 px-4 py-3.5",
              canShowDragCursor && "lg:cursor-move lg:select-none",
            )}
            onPointerDown={handleHeaderPointerDown}
            onPointerMove={handleHeaderPointerMove}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
          >
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="truncate text-[13.5px] font-medium text-ink-900">
                {content.title ?? ""}
              </DialogPrimitive.Title>
              {content.description ? (
                <DialogPrimitive.Description className="mt-0.5 truncate text-[12px] text-ink-500">
                  {content.description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogClose asChild>
              <button
                type="button"
                data-dialog-no-drag
                onPointerDown={(event) => event.stopPropagation()}
                className={cn(
                  "grid h-8 w-8 flex-shrink-0 place-items-center rounded-md text-ink-400",
                  "transition-colors duration-100",
                  "hover:bg-ink-900/[0.08] hover:text-ink-900",
                  "focus:outline-none focus:ring-2 focus:ring-terra-300/60",
                )}
                aria-label={frontendMessage("ui.close")}
              >
                <X className="h-4 w-4" />
              </button>
            </DialogClose>
          </div>
          <div className={content.bodyClassName}>{content.children}</div>
        </MotionDialogContent>
      </div>
    );
  },
);
DialogContentFrame.displayName = "DialogContentFrame";

export const DialogContent = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    title?: string;
    description?: string;
    bodyClassName?: string;
    frameClassName?: string;
    placement?: "center" | "inset";
    motionPreset?: DialogMotionPreset;
    draggable?: boolean;
    contentInitial?: false | VariantLabels;
    contentVariants?: Variants;
    contentTransition?: Transition;
  }
>(
  (
    {
      className,
      children,
      title,
      description,
      bodyClassName,
      frameClassName,
      placement = "center",
      motionPreset = "modal",
      draggable = true,
      contentInitial,
      contentVariants,
      contentTransition,
      ...props
    },
    ref,
  ) => (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content ref={ref} asChild forceMount {...props}>
        <DialogContentFrame
          className={cn(
            "dialog-presence",
            placement === "center" ? "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2" : "fixed z-50",
            placement === "inset" && "flex",
            frameClassName,
          )}
          panelClassName={cn(
            "w-[min(720px,calc(100vw-28px))] max-h-[min(720px,calc(100vh-28px))]",
            "flex flex-col overflow-hidden rounded-xl border border-ink-200/80 bg-paper-50 shadow-soft [contain:layout_paint] [will-change:opacity,transform]",
            placement === "inset" && "min-h-0 flex-1",
            className,
          )}
          title={title}
          description={description}
          bodyClassName={bodyClassName}
          draggable={draggable}
          motionPreset={motionPreset}
          contentInitial={contentInitial}
          contentVariants={contentVariants}
          contentTransition={contentTransition}
        >
          {children}
        </DialogContentFrame>
      </DialogPrimitive.Content>
    </DialogPortal>
  ),
);
DialogContent.displayName = "DialogContent";

export type DialogActionVariant = "secondary" | "primary" | "danger";

export interface DialogActionsProps {
  children: ReactNode;
  className?: string;
}

export interface DialogActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  close?: boolean;
  variant?: DialogActionVariant;
}

const dialogActionVariantClasses: Record<DialogActionVariant, string> = {
  secondary: "text-ink-600 hover:bg-ink-900/[0.05] hover:text-ink-900",
  primary: "bg-ink-900 font-medium text-paper-50 hover:bg-ink-800",
  danger: "bg-brick-500 font-medium text-paper-50 hover:bg-brick-600 focus:ring-brick-200/60",
};

export function DialogActions({ children, className }: DialogActionsProps): JSX.Element {
  return <div className={cn("flex justify-end gap-2", className)}>{children}</div>;
}

export const DialogActionButton = forwardRef<HTMLButtonElement, DialogActionButtonProps>(
  ({ close = false, variant = "secondary", className, type = "button", ...props }, ref) => {
    const button = (
      <button
        ref={ref}
        type={type}
        className={cn(
          "h-8 rounded-md px-3 text-[12.5px] transition focus:outline-none focus:ring-2 focus:ring-terra-200/60 disabled:cursor-not-allowed disabled:opacity-45",
          dialogActionVariantClasses[variant],
          className,
        )}
        {...props}
      />
    );

    if (!close) return button;

    return <DialogClose asChild>{button}</DialogClose>;
  },
);
DialogActionButton.displayName = "DialogActionButton";
