import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { MotionConfig, useReducedMotion } from "framer-motion";
import type { MotionLevel } from "./types";

interface MotionLevelContextValue {
  level: MotionLevel;
  prefersReducedMotion: boolean;
  reduceMotion: boolean;
  disableMotion: boolean;
}

const MotionLevelContext = createContext<MotionLevelContextValue>({
  level: "full",
  prefersReducedMotion: false,
  reduceMotion: false,
  disableMotion: false,
});

export function AppMotionProvider({
  children,
  level = "full",
}: {
  children: ReactNode;
  level?: MotionLevel;
}): JSX.Element {
  const prefersReducedMotion = useReducedMotion() ?? false;
  const disableMotion = level === "none";
  const reduceMotion = disableMotion || level === "reduced" || prefersReducedMotion;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.motionLevel = level;
    return () => {
      if (root.dataset.motionLevel === level) {
        delete root.dataset.motionLevel;
      }
    };
  }, [level]);

  const value = useMemo(
    () => ({
      level,
      prefersReducedMotion,
      reduceMotion,
      disableMotion,
    }),
    [disableMotion, level, prefersReducedMotion, reduceMotion],
  );

  return (
    <MotionConfig reducedMotion={disableMotion ? "always" : "user"}>
      <MotionLevelContext.Provider value={value}>{children}</MotionLevelContext.Provider>
    </MotionConfig>
  );
}

export function useMotionLevel(): MotionLevelContextValue {
  return useContext(MotionLevelContext);
}
