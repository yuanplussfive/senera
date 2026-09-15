import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Toaster, type ToasterProps } from "sonner";
import { ResonanceTrace } from "./LoadingSignal";

function ToastIcon({ children, tone }: { children: ReactNode; tone: "info" | "warning" | "error" }): JSX.Element {
  return <span className={`senera-toast-icon-glyph senera-toast-icon-glyph-${tone}`}>{children}</span>;
}

const seneraToastIcons = {
  success: <ResonanceTrace size="sm" state="settled" />,
  loading: <ResonanceTrace size="sm" />,
  info: (
    <ToastIcon tone="info">
      <Info />
    </ToastIcon>
  ),
  warning: (
    <ToastIcon tone="warning">
      <TriangleAlert />
    </ToastIcon>
  ),
  error: (
    <ToastIcon tone="error">
      <CircleAlert />
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

/**
 * Shared status surface for save, sync and recovery feedback. The component
 * keeps the Sonner API at the application edge while its visual language is
 * owned by Senera's resonance trace.
 */
export function SeneraToaster({ position = "bottom-right" }: { position?: ToasterProps["position"] }): JSX.Element {
  return <Toaster position={position} icons={seneraToastIcons} toastOptions={seneraToastOptions} />;
}
