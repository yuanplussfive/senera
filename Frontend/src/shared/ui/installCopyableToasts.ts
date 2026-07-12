import { isValidElement, type MouseEvent, type ReactNode } from "react";
import { toast, type ExternalToast } from "sonner";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";

type ToastMethod = (message: ReactNode | (() => ReactNode), data?: ExternalToast) => string | number;

let installed = false;

export function installCopyableToasts(): void {
  if (installed) return;
  installed = true;

  toast.success = withCopyAction(toast.success);
  toast.info = withCopyAction(toast.info);
  toast.warning = withCopyAction(toast.warning);
  toast.error = withCopyAction(toast.error);
  toast.message = withCopyAction(toast.message);
  toast.loading = withCopyAction(toast.loading);
}

function withCopyAction(method: ToastMethod): ToastMethod {
  return (message, data) => method(message, addToastCopyAction(message, data));
}

function addToastCopyAction(message: ReactNode | (() => ReactNode), data?: ExternalToast): ExternalToast | undefined {
  const copyText = formatToastCopyText(message, data?.description);
  if (!copyText) return data;

  const copyAction = {
    label: frontendMessage("clipboard.copyToast"),
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      void writeToastCopyText(copyText);
    },
  };

  if (!data?.action) {
    return {
      ...data,
      action: copyAction,
    };
  }

  if (!data.cancel) {
    return {
      ...data,
      cancel: copyAction,
    };
  }

  return data;
}

function formatToastCopyText(
  message: ReactNode | (() => ReactNode),
  description?: ReactNode | (() => ReactNode),
): string {
  return [readNodeText(message), readNodeText(description)].filter(Boolean).join("\n");
}

function readNodeText(value: ReactNode | (() => ReactNode) | undefined): string {
  if (value === undefined || value === null || typeof value === "boolean") return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "function") {
    try {
      return readNodeText(value());
    } catch {
      return "";
    }
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => readNodeText(item))
      .filter(Boolean)
      .join(" ");
  }
  if (isValidElement<{ children?: ReactNode }>(value)) {
    return readNodeText(value.props.children);
  }
  return "";
}

async function writeToastCopyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    copyTextWithTextarea(text);
  }
}

function copyTextWithTextarea(text: string): void {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}
