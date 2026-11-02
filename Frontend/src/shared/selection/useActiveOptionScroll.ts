import { useEffect, useRef } from "react";

/** Reveal keyboard selection inside its own viewport without scrolling the page. */
export function useActiveOptionScroll(activeKey: string | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = ref.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    const active = viewport?.querySelector<HTMLElement>('[data-active-option="true"]');
    if (!viewport || !active) return;
    const bounds = viewport.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    if (item.top < bounds.top) viewport.scrollTop += item.top - bounds.top;
    else if (item.bottom > bounds.bottom) viewport.scrollTop += item.bottom - bounds.bottom;
  }, [activeKey]);
  return ref;
}
