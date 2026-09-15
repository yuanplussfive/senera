import { useEffect, useMemo, type ReactNode } from "react";
import { MotionConfig, useReducedMotion } from "framer-motion";
import type { MotionLevel } from "./types";
import { MotionLevelContext } from "./MotionLevelContext";

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
    <MotionConfig reducedMotion={reduceMotion ? "always" : "user"}>
      <MotionLevelContext.Provider value={value}>{children}</MotionLevelContext.Provider>
    </MotionConfig>
  );
}

export { useMotionLevel } from "./MotionLevelContext";
