import { createContext, useContext } from "react";

/** Portalled controls stay inside their modal's native scroll and focus boundary. */
export const OverlayPortalScope = createContext<HTMLElement | null>(null);

/** Nested menus inherit their parent's layer even when Radix portals them elsewhere. */
export const OverlayLayerScope = createContext(70);

export function useOverlayLayer(): number {
  return useContext(OverlayLayerScope);
}

export function useOverlayPortalContainer(): HTMLElement | null {
  return useContext(OverlayPortalScope);
}
