import { useLayoutEffect, type RefObject } from "react";

/** Keeps a fixed overlay modal without adding a focus-trap dependency. */
export function useInertSiblings(ref: RefObject<HTMLElement | null>, enabled = true): void {
  useLayoutEffect(() => {
    if (!enabled) return;

    const overlay = ref.current;
    const parent = overlay?.parentElement;
    if (!overlay || !parent) return;

    const siblings = Array.from(parent.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && child !== overlay,
    );
    const previousInert = siblings.map((sibling) => ({ sibling, inert: sibling.inert }));
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;

    for (const sibling of siblings) sibling.inert = true;
    overlay.focus({ preventScroll: true });

    return () => {
      for (const { sibling, inert } of previousInert) sibling.inert = inert;
      if (previouslyFocused?.isConnected && !previouslyFocused.inert) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [enabled, ref]);
}
