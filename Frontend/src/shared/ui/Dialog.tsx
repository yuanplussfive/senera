import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { forwardRef, useRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import type { Transition, VariantLabels, Variants } from "framer-motion";
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

const dialogPresenceStyle = {
  "--dialog-presence-exit-dur": `${dialogPresenceExitMs}ms`,
} satisfies DialogPresenceStyle;

function mergeDialogPresenceStyle(style?: CSSProperties): DialogPresenceStyle {
  return style ? { ...dialogPresenceStyle, ...style } : dialogPresenceStyle;
}

export const DialogOverlay = forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>>(
  ({ className, style, ...props }, ref) => (
    <DialogPrimitive.Overlay ref={ref} asChild forceMount {...props}>
      <MotionDialogOverlay
        className={cn("dialog-presence fixed inset-0 z-50 bg-ink-950/52 [will-change:opacity]", className)}
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
    const frameStyle = mergeDialogPresenceStyle(
      dataState === "closed" ? { ...(style ?? {}), pointerEvents: "none" } : style,
    );

    return (
      <div ref={ref} className={className} data-state={dataState} style={frameStyle} {...props}>
        <MotionDialogContent
          className={content.panelClassName}
          data-dialog-panel="true"
          data-state={dataState}
          motionPreset={content.motionPreset}
          initial={content.contentInitial}
          variants={content.contentVariants}
          transition={content.contentTransition}
        >
          <div className="flex items-start gap-4 bg-paper-50 px-8 pb-4 pt-7">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-[20px] font-semibold leading-7 text-ink-950">
                {content.title ?? ""}
              </DialogPrimitive.Title>
              {content.description ? (
                <DialogPrimitive.Description className="mt-1.5 text-[13px] leading-5 text-ink-500">
                  {content.description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogClose asChild>
              <button
                type="button"
                className={cn(
                  "grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg text-ink-400",
                  "transition-colors duration-150 ease-out",
                  "hover:bg-ink-900/[0.08] hover:text-ink-900",
                  "focus:outline-none focus:ring-4 focus:ring-ink-900/[0.08]",
                )}
                aria-label="关闭"
              >
                <X className="h-[18px] w-[18px]" />
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
            "w-[min(600px,calc(100vw-32px))] max-h-[min(800px,calc(100dvh-32px))]",
            "flex flex-col overflow-hidden [will-change:opacity,transform]",
            placement === "inset" && "min-h-0 flex-1",
            className,
            "rounded-[10px] border border-ink-200 bg-paper-50 shadow-[0_14px_36px_-18px_rgb(24_25_28/0.38),0_2px_8px_-4px_rgb(24_25_28/0.18)]",
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
  secondary:
    "border border-ink-200 bg-paper-50 text-ink-700 shadow-[0_1px_2px_rgb(33_30_24/0.04)] hover:border-ink-300 hover:bg-ink-900/[0.035] hover:text-ink-900",
  primary:
    "bg-ink-900 font-medium text-paper-50 shadow-[0_1px_2px_rgb(33_30_24/0.2),0_6px_14px_-8px_rgb(33_30_24/0.5)] hover:bg-ink-800",
  danger:
    "bg-brick-500 font-medium text-paper-50 shadow-[0_1px_2px_rgb(146_64_14/0.24)] hover:bg-brick-600 focus:ring-brick-200/60",
};

export function DialogActions({ children, className }: DialogActionsProps): JSX.Element {
  return <div className={cn("flex justify-end gap-2 border-t border-ink-200/70 pt-5", className)}>{children}</div>;
}

export const DialogActionButton = forwardRef<HTMLButtonElement, DialogActionButtonProps>(
  ({ close = false, variant = "secondary", className, type = "button", ...props }, ref) => {
    const button = (
      <button
        ref={ref}
        type={type}
        className={cn(
          "h-10 rounded-lg px-4 text-[13px] transition-[background-color,border-color,box-shadow,color] duration-150 ease-out focus:outline-none focus:ring-2 focus:ring-terra-300/60 disabled:cursor-not-allowed disabled:opacity-45",
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
