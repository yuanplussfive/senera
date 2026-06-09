import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { forwardRef, useRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import type { Transition, VariantLabels, Variants } from "framer-motion";
import { cn } from "../../lib/util";
import {
  dialogPresenceExitMs,
  MotionDialogContent,
  MotionDialogOverlay,
  type DialogMotionPreset,
} from "../motion";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

type DialogPresenceStyle = CSSProperties & {
  "--dialog-presence-exit-dur"?: string;
};

const dialogPresenceStyle = {
  "--dialog-presence-exit-dur": `${dialogPresenceExitMs}ms`,
} satisfies DialogPresenceStyle;

function mergeDialogPresenceStyle(style?: CSSProperties): DialogPresenceStyle {
  return style ? { ...dialogPresenceStyle, ...style } : dialogPresenceStyle;
}

export const DialogOverlay = forwardRef<
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
      "dialog-presence fixed inset-0 z-50 bg-ink-950/40 backdrop-blur-[1px]",
      className,
    )}
    style={mergeDialogPresenceStyle(style)}
    />
  </DialogPrimitive.Overlay>
));
DialogOverlay.displayName = "DialogOverlay";

type DialogContentSnapshot = {
  bodyClassName?: string;
  children: ReactNode;
  contentInitial?: false | VariantLabels;
  contentTransition?: Transition;
  contentVariants?: Variants;
  description?: string;
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
    motionPreset: DialogMotionPreset;
    contentInitial?: false | VariantLabels;
    contentVariants?: Variants;
    contentTransition?: Transition;
    "data-state"?: string;
  }
>(({
  className,
  children,
  title,
  description,
  bodyClassName,
  frameClassName: _frameClassName,
  panelClassName,
  motionPreset,
  contentInitial,
  contentVariants,
  contentTransition,
  style,
  "data-state": dataState,
  ...props
}, ref) => {
  const liveContent: DialogContentSnapshot = {
    bodyClassName,
    children,
    contentInitial,
    contentTransition,
    contentVariants,
    description,
    motionPreset,
    panelClassName,
    title,
  };
  const openContentRef = useRef(liveContent);
  if (dataState !== "closed") {
    openContentRef.current = liveContent;
  }
  const content = dataState === "closed" ? openContentRef.current : liveContent;

  return (
    <div
      ref={ref}
      className={className}
      data-state={dataState}
      style={mergeDialogPresenceStyle(style)}
      {...props}
    >
      <MotionDialogContent
        className={content.panelClassName}
        data-dialog-panel="true"
        data-state={dataState}
        motionPreset={content.motionPreset}
        initial={content.contentInitial}
        variants={content.contentVariants}
        transition={content.contentTransition}
      >
      <div className="flex items-start gap-3 border-b border-ink-200/50 bg-paper-50 px-4 py-3.5">
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
            className={cn(
              "grid h-8 w-8 flex-shrink-0 place-items-center rounded-md text-ink-400",
              "transition-all duration-150",
              "hover:bg-ink-900/[0.08] hover:text-ink-900 hover:scale-105",
              "active:scale-95",
              "focus:outline-none focus:ring-2 focus:ring-terra-300/60",
            )}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </DialogClose>
      </div>
        <div className={content.bodyClassName}>{content.children}</div>
      </MotionDialogContent>
    </div>
  );
});
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
    contentInitial?: false | VariantLabels;
    contentVariants?: Variants;
    contentTransition?: Transition;
  }
>(({ className, children, title, description, bodyClassName, frameClassName, placement = "center", motionPreset = "modal", contentInitial, contentVariants, contentTransition, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      asChild
      forceMount
      {...props}
    >
      <DialogContentFrame
        className={cn(
          "dialog-presence",
          // Center the dialog on a line slightly above the viewport midpoint.
          placement === "center"
            ? "fixed left-1/2 top-[42vh] z-50 -translate-x-1/2 -translate-y-1/2"
            : "fixed z-50",
          placement === "inset" && "flex",
          frameClassName,
        )}
        panelClassName={cn(
          "w-[min(720px,calc(100vw-28px))] max-h-[min(720px,calc(100vh-28px))]",
          "flex flex-col overflow-hidden rounded-xl border border-ink-200/80 bg-paper-50 shadow-soft",
          placement === "inset" && "min-h-0 flex-1",
          className,
        )}
        title={title}
        description={description}
        bodyClassName={bodyClassName}
        motionPreset={motionPreset}
        contentInitial={contentInitial}
        contentVariants={contentVariants}
        contentTransition={contentTransition}
      >
        {children}
      </DialogContentFrame>
    </DialogPrimitive.Content>
  </DialogPortal>
));
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
  return (
    <div className={cn("flex justify-end gap-2", className)}>
      {children}
    </div>
  );
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
