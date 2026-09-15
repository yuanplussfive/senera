import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useMotionLevel } from "../motion/MotionProvider";
import type { MotionLevel } from "../motion/types";
import { type AppearancePreferenceUpdate, type AppearanceSnapshot } from "./themeModel";
import { createAppearanceStore } from "./themeStore";

const appearanceStore = createAppearanceStore();

export function useAppearance(): AppearanceSnapshot {
  return useSyncExternalStore(
    appearanceStore.subscribe,
    appearanceStore.getSnapshot,
    appearanceStore.getServerSnapshot,
  );
}

export function useSetAppearancePreference(): (preference: AppearancePreferenceUpdate) => void {
  return appearanceStore.setPreference;
}

export function AppAppearanceProvider({
  children,
  motionLevel,
}: {
  children: ReactNode;
  motionLevel: MotionLevel;
}): JSX.Element {
  const { prefersReducedMotion } = useMotionLevel();
  const snapshot = useAppearance();

  useEffect(() => {
    void import("../../styles/fontPresets/jetbrainsMono.css").catch(() => undefined);
    void import("./fontRuntime")
      .then(({ ensureAppearanceFontLoaded }) => ensureAppearanceFontLoaded(snapshot.preference.fontFamily))
      .catch(() => undefined);
  }, [snapshot.preference.fontFamily]);

  useEffect(() => {
    appearanceStore.setMotionLevel(motionLevel, prefersReducedMotion);
  }, [motionLevel, prefersReducedMotion]);

  return <>{children}</>;
}
