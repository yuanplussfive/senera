import { useEffect } from "react";

export type GlobalShortcutAction = "new_session" | "toggle_session_panel";

type ShortcutLike = Pick<KeyboardEvent, "ctrlKey" | "key" | "metaKey"> & {
  target?: EventTarget | null;
};

export function resolveGlobalShortcut(event: ShortcutLike): GlobalShortcutAction | null {
  if (isEditableShortcutTarget(event.target)) return null;
  const meta = event.metaKey || event.ctrlKey;
  if (!meta) return null;
  const key = event.key.toLowerCase();
  if (key === "b") return "toggle_session_panel";
  if (key === "n") return "new_session";
  return null;
}

function isEditableShortcutTarget(target: EventTarget | null | undefined): boolean {
  if (!target || typeof target !== "object") return false;
  const candidate = target as Partial<HTMLElement>;
  if (candidate.isContentEditable) return true;
  const tagName = typeof candidate.tagName === "string" ? candidate.tagName.toLowerCase() : "";
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

interface UseGlobalShortcutsInput {
  onNewSession: () => void;
  onToggleSessionPanel: () => void;
}

export function useGlobalShortcuts({ onNewSession, onToggleSessionPanel }: UseGlobalShortcutsInput): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const action = resolveGlobalShortcut(event);
      if (!action) return;
      event.preventDefault();
      if (action === "toggle_session_panel") {
        onToggleSessionPanel();
        return;
      }
      onNewSession();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onNewSession, onToggleSessionPanel]);
}
