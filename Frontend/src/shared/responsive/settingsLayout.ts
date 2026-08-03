import { useEffect, useRef, useState, type RefObject } from "react";

export type SettingsShellLayout = "compact" | "persistent";
export type SettingsContentLayout = "compact" | "standard" | "wide";

export function classifySettingsShellLayout(width: number): SettingsShellLayout {
  return width < 800 ? "compact" : "persistent";
}

export function classifySettingsContentLayout(width: number): SettingsContentLayout {
  if (width < 720) return "compact";
  if (width < 1100) return "standard";
  return "wide";
}

export function useObservedLayout<T extends HTMLElement, TLayout>(
  classify: (width: number) => TLayout,
  initial: TLayout,
): { ref: RefObject<T>; layout: TLayout } {
  const ref = useRef<T>(null);
  const [layout, setLayout] = useState<TLayout>(initial);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = (width: number): void => {
      setLayout((current) => {
        const next = classify(width);
        return Object.is(current, next) ? current : next;
      });
    };

    update(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [classify]);

  return { ref, layout };
}
