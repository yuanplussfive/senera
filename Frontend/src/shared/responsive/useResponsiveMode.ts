import { useSyncExternalStore } from "react";
import { createResponsiveModeStore } from "./responsiveStore";
import type { ResponsiveMode } from "./responsiveMode";

const responsiveModeStore = createResponsiveModeStore();

export function useResponsiveMode(): ResponsiveMode {
  return useSyncExternalStore(
    responsiveModeStore.subscribe,
    responsiveModeStore.getSnapshot,
    responsiveModeStore.getServerSnapshot,
  );
}
