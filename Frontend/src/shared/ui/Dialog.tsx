import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { forwardRef, useRef, type CSSProperties, type ReactNode } from "react";
import type { Transition, VariantLabels, Variants } from "framer-motion";
import { cn } from "../../lib/util";
import { dialogPresenceExitMs, MotionDialogContent, MotionDialogOverlay, type DialogMotionPreset } from "../motion";
import { Button, type ButtonProps } from "./Button";
import { AppIcon } from "./AppIcon";

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
    <DialogPrimitive.Overlay ref={ref} asChild {...props}>
      <MotionDialogOverlay
        className={cn(
          "dialog-presence fixed inset-0 z-50 bg-[var(--theme-dialog-backdrop)] [will-change:opacity]",
          className,
        )}
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
  footer?: ReactNode;
  footerClassName?: string;
  motionPreset: DialogMotionPreset;
  panelClassName?: string;
  showClose: boolean;
  showHeader: boolean;
  title?: string;
};

const DialogContentFrame = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div"> & {
    title?: string;
    description?: string;
    bodyClassName?: string;
    footer?: ReactNode;
    footerClassName?: string;
    frameClassName?: string;
    panelClassName?: string;
    showClose: boolean;
    showHeader: boolean;
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
      footer,
      footerClassName,
      frameClassName: _frameClassName,
      panelClassName,
      showClose,
      showHeader,
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
      footer,
      footerClassName,
      motionPreset,
      panelClassName,
      showClose,
      showHeader,
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
          {content.showHeader ? (
            <div className="flex select-none items-start gap-4 bg-surface-panel px-6 pb-4 pt-5">
              <div className="min-w-0 flex-1">
                <DialogPrimitive.Title className="text-[16px] font-medium leading-6 text-content-strong">
                  {content.title ?? ""}
                </DialogPrimitive.Title>
                {content.description ? (
                  <DialogPrimitive.Description className="mt-1 text-[13px] leading-5 text-content-secondary">
                    {content.description}
                  </DialogPrimitive.Description>
                ) : null}
              </div>
              {content.showClose ? (
                <DialogClose asChild>
                  <button
                    type="button"
                    className={cn(
                      "grid h-6 w-6 flex-shrink-0 place-items-center rounded-md text-content-muted",
                      "cursor-pointer",
                      "transition-colors duration-[var(--menu-item-dur)] ease-out",
                      "hover:bg-surface-hover hover:text-content-primary",
                      "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
                    )}
                    aria-label={frontendMessage("ui.close")}
                  >
                    <AppIcon icon="close" size={14} aria-hidden="true" />
                  </button>
                </DialogClose>
              ) : null}
            </div>
          ) : (
            <>
              <DialogPrimitive.Title className="sr-only">{content.title ?? ""}</DialogPrimitive.Title>
              {content.description ? (
                <DialogPrimitive.Description className="sr-only">{content.description}</DialogPrimitive.Description>
              ) : null}
            </>
          )}
          <div className={content.bodyClassName}>{content.children}</div>
          {content.footer ? (
            <div className={cn("shrink-0 px-6 pb-3.5 pt-4", content.footerClassName)} data-dialog-footer>
              {content.footer}
            </div>
          ) : null}
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
    footer?: ReactNode;
    footerClassName?: string;
    frameClassName?: string;
    placement?: "center" | "inset";
    motionPreset?: DialogMotionPreset;
    showClose?: boolean;
    showHeader?: boolean;
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
      footer,
      footerClassName,
      frameClassName,
      placement = "center",
      motionPreset = "modal",
      showClose = true,
      showHeader = true,
      contentInitial,
      contentVariants,
      contentTransition,
      ...props
    },
    ref,
  ) => (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        asChild
        {...(!description ? { "aria-describedby": undefined } : {})}
        {...props}
      >
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
            "rounded-xl border border-line bg-surface-panel",
          )}
          title={title}
          description={description}
          bodyClassName={bodyClassName}
          footer={footer}
          footerClassName={footerClassName}
          motionPreset={motionPreset}
          showClose={showClose}
          showHeader={showHeader}
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

export interface DialogActionButtonProps extends Omit<ButtonProps, "variant" | "size"> {
  close?: boolean;
  variant?: DialogActionVariant;
}

export function DialogActions({ children, className }: DialogActionsProps): JSX.Element {
  return (
    <div className={cn("flex justify-end gap-2.5", className)} data-dialog-actions>
      {children}
    </div>
  );
}

export const DialogActionButton = forwardRef<HTMLButtonElement, DialogActionButtonProps>(
  ({ close = false, variant = "secondary", className, type = "button", ...props }, ref) => {
    const button = (
      <Button
        ref={ref}
        type={type}
        size="sm"
        variant={variant === "primary" ? "default" : variant === "danger" ? "destructive" : "outline"}
        className={cn(
          "min-w-[96px]",
          variant === "primary" &&
            "bg-content-strong text-content-inverse shadow-soft hover:bg-content-strong/90 hover:shadow-soft active:bg-content-strong/80",
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
