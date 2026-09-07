import { useEffect, useState } from "react";

export interface ViewportSize {
  width: number;
  height: number;
}

const DefaultViewportSize: ViewportSize = { width: 1280, height: 720 };

export function useViewportSize(): ViewportSize {
  const [viewport, setViewport] = useState(readViewportSize);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    const update = (): void => {
      const next = readViewportSize();
      setViewport((current) => (current.width === next.width && current.height === next.height ? current : next));
    };
    window.addEventListener("resize", update);
    visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      visualViewport?.removeEventListener("resize", update);
    };
  }, []);

  return viewport;
}

export function readViewportSize(): ViewportSize {
  if (typeof window === "undefined") return DefaultViewportSize;
  const visualViewport = window.visualViewport;
  return {
    width: Math.max(1, Math.round(visualViewport?.width ?? window.innerWidth)),
    height: Math.max(1, Math.round(visualViewport?.height ?? window.innerHeight)),
  };
}
