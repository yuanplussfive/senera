import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "../../lib/util";
import { useMotionLevel } from "./MotionProvider";
import { motionSprings, motionTimings } from "./presets";

export function MotionPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  const { reduceMotion, disableMotion } = useMotionLevel();
  return (
    <motion.div
      initial={disableMotion ? false : reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.985 }}
      animate={disableMotion ? undefined : { opacity: 1, scale: 1 }}
      exit={disableMotion ? undefined : reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.985 }}
      transition={disableMotion ? { duration: 0 } : reduceMotion ? motionTimings.base : motionSprings.soft}
      className={cn(className)}
    >
      {children}
    </motion.div>
  );
}
