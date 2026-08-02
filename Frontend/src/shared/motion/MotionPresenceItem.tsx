import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "../../lib/util";
import { useMotionLevel } from "./MotionProvider";
import { motionSprings, motionTimings } from "./presets";

export function MotionPresenceItem({
  children,
  className,
  layout = "position",
}: {
  children: ReactNode;
  className?: string;
  layout?: false | "position";
}): JSX.Element {
  const { reduceMotion, disableMotion } = useMotionLevel();
  const hidden = reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 };
  const exit = reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 };
  const enterTransition = disableMotion ? { duration: 0 } : motionTimings.base;
  const exitTransition = disableMotion ? { duration: 0 } : motionTimings.fast;

  return (
    <motion.div
      layout={reduceMotion || disableMotion ? false : layout}
      initial={disableMotion ? false : hidden}
      animate={{ opacity: 1, y: 0, transition: enterTransition }}
      exit={{ ...exit, transition: exitTransition }}
      transition={{ layout: disableMotion ? { duration: 0 } : motionSprings.snappy }}
      className={cn("min-w-0", className)}
    >
      {children}
    </motion.div>
  );
}
