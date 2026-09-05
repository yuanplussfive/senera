import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "../../lib/util";
import { useMotionLevel } from "./MotionProvider";
import { motionTimings } from "./presets";

export function MotionPanel({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  const { reduceMotion, disableMotion } = useMotionLevel();
  return (
    <motion.div
      initial={disableMotion ? false : reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
      animate={disableMotion ? undefined : { opacity: 1, y: 0 }}
      exit={disableMotion ? undefined : reduceMotion ? { opacity: 0 } : { opacity: 0, y: 2 }}
      transition={disableMotion ? { duration: 0 } : motionTimings.base}
      className={cn(className)}
    >
      {children}
    </motion.div>
  );
}
