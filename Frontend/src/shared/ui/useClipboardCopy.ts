import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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

export async function writeClipboardText(
  text: string,
  clipboard?: ClipboardWriter,
): Promise<void> {
  const writer = clipboard ?? navigator.clipboard;
  await writer.writeText(text);
}

export function useClipboardCopy({
  successMessage = DEFAULT_SUCCESS_MESSAGE,
  errorMessage = DEFAULT_ERROR_MESSAGE,
  resetDelayMs = DEFAULT_RESET_DELAY_MS,
  clipboard,
}: ClipboardCopyOptions = {}): ClipboardCopyResult {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number>();

  const clearResetTimer = useCallback((): void => {
    if (resetTimerRef.current === undefined) return;
    window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = undefined;
  }, []);

  const copyText = useCallback(async (text: string): Promise<boolean> => {
    try {
      await writeClipboardText(text, clipboard);
      setCopied(true);
      toast.success(successMessage);
      clearResetTimer();
      resetTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        resetTimerRef.current = undefined;
      }, resetDelayMs);
      return true;
    } catch {
      toast.error(errorMessage);
      return false;
    }
  }, [clearResetTimer, clipboard, errorMessage, resetDelayMs, successMessage]);

  useEffect(() => clearResetTimer, [clearResetTimer]);

  return { copied, copyText };
}
