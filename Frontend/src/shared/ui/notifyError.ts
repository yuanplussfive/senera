import type { MouseEvent, ReactNode } from "react";
import { toast, type ExternalToast } from "sonner";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { writeClipboardText } from "./useClipboardCopy";

export interface NotifyErrorOptions extends Omit<ExternalToast, "action" | "cancel" | "description"> {
  title: ReactNode;
  description?: ReactNode;
  action?: ExternalToast["action"];
  diagnosticText?: string;
}

export function notifyError({
  title,
  description,
  action,
  diagnosticText,
  ...options
}: NotifyErrorOptions): string | number {
  return toast.error(title, {
    ...options,
    description,
    action: action ?? (diagnosticText ? createCopyAction(diagnosticText) : undefined),
  });
}

function createCopyAction(diagnosticText: string): NonNullable<ExternalToast["action"]> {
  return {
    label: frontendMessage("clipboard.copyToast"),
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      void writeClipboardText(diagnosticText).catch(() => {
        // The diagnostic remains visible and can still be selected manually.
      });
    },
  };
}
