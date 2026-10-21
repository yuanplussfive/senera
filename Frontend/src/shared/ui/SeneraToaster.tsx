import type { ReactNode } from "react";
import { Toaster, type ToasterProps } from "sonner";
import { AppIcon } from "./AppIcon";
import { Spinner } from "./Spinner";

function ToastIcon({ children, tone }: { children: ReactNode; tone: "info" | "warning" | "error" }): JSX.Element {
  return <span className={`senera-toast-icon-glyph senera-toast-icon-glyph-${tone}`}>{children}</span>;
}

const seneraToastIcons = {
  success: <AppIcon icon="check" size={15} aria-hidden="true" />,
  loading: <Spinner size="sm" />,
  info: (
    <ToastIcon tone="info">
      <AppIcon icon="info" size={15} aria-hidden="true" />
    </ToastIcon>
  ),
  warning: (
    <ToastIcon tone="warning">
      <AppIcon icon="warning" size={15} aria-hidden="true" />
    </ToastIcon>
  ),
  error: (
    <ToastIcon tone="error">
      <AppIcon icon="alert" size={15} aria-hidden="true" />
    </ToastIcon>
  ),
};

const seneraToastOptions: NonNullable<ToasterProps["toastOptions"]> = {
  className: "senera-toast !font-sans",
  classNames: {
    icon: "senera-toast-icon",
    content: "senera-toast-content",
    title: "senera-toast-title",
    description: "senera-toast-description",
    actionButton: "senera-toast-action",
    cancelButton: "senera-toast-cancel",
    closeButton: "senera-toast-close",
  },
};

/** Shared status surface for save, sync and recovery feedback. */
export function SeneraToaster({ position = "bottom-right" }: { position?: ToasterProps["position"] }): JSX.Element {
  return <Toaster position={position} icons={seneraToastIcons} toastOptions={seneraToastOptions} />;
}
