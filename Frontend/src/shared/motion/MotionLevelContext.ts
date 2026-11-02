import { createContext, useContext } from "react";
import type { MotionLevel } from "./types";

export interface MotionLevelContextValue {
  level: MotionLevel;
  prefersReducedMotion: boolean;
  reduceMotion: boolean;
  disableMotion: boolean;
}

export const MotionLevelContext = createContext<MotionLevelContextValue>({
  level: "full",
  prefersReducedMotion: false,
  reduceMotion: false,
  disableMotion: false,
});

export function useMotionLevel(): MotionLevelContextValue {
  return useContext(MotionLevelContext);
}
