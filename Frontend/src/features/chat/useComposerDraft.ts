import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
};

export function useComposerDraft(key: string): [string, (value: string) => void] {
  const storageKey = `senera-composer:${key}`;
  const read = useCallback(() => localStorage.getItem(storageKey) ?? "", [storageKey]);
  const value = useSyncExternalStore(subscribe, read);
  const update = useCallback(
    (next: string) => {
      if (next.length) localStorage.setItem(storageKey, next);
      else localStorage.removeItem(storageKey);
      for (const listener of listeners) listener();
    },
    [storageKey],
  );
  return [value, update];
}
