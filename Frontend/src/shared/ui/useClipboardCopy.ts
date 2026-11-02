import { useCallback, useEffect, useRef, useState } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";

export type ClipboardWriter = Pick<Clipboard, "writeText">;

export interface ClipboardCopyOptions {
  successMessage?: string;
  errorMessage?: string;
  resetDelayMs?: number;
  clipboard?: ClipboardWriter;
}

export interface ClipboardCopyResult {
  copied: boolean;
  copyText: (text: string) => Promise<boolean>;
}

const DEFAULT_SUCCESS_MESSAGE = frontendMessage("clipboard.copied");
const DEFAULT_ERROR_MESSAGE = frontendMessage("clipboard.copyFailed");
const DEFAULT_RESET_DELAY_MS = 1200;

export async function writeClipboardText(text: string, clipboard?: ClipboardWriter): Promise<void> {
  if (clipboard) {
    await clipboard.writeText(text);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    if (!copyTextWithTextarea(text)) throw error;
  }
}

function copyTextWithTextarea(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

export function useClipboardCopy({
  successMessage = DEFAULT_SUCCESS_MESSAGE,
  errorMessage = DEFAULT_ERROR_MESSAGE,
  resetDelayMs = DEFAULT_RESET_DELAY_MS,
  clipboard,
}: ClipboardCopyOptions = {}): ClipboardCopyResult {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | undefined>(undefined);

  const clearResetTimer = useCallback((): void => {
    if (resetTimerRef.current === undefined) return;
    window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = undefined;
  }, []);

  const copyText = useCallback(
    async (text: string): Promise<boolean> => {
      // Start the browser write in the click handler's activation context.
      // Notification UI is loaded on demand and does not decide whether copying succeeded.
      const [write, notification] = await Promise.allSettled([writeClipboardText(text, clipboard), import("sonner")]);
      const succeeded = write.status === "fulfilled";
      if (succeeded) {
        setCopied(true);
        clearResetTimer();
        resetTimerRef.current = window.setTimeout(() => {
          setCopied(false);
          resetTimerRef.current = undefined;
        }, resetDelayMs);
      }
      if (notification.status === "fulfilled") {
        if (succeeded) notification.value.toast.success(successMessage);
        else notification.value.toast.error(errorMessage);
      }
      return succeeded;
    },
    [clearResetTimer, clipboard, errorMessage, resetDelayMs, successMessage],
  );

  useEffect(() => clearResetTimer, [clearResetTimer]);

  return { copied, copyText };
}
