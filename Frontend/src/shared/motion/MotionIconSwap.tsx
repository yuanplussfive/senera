import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "../../lib/util";
import { useMotionLevel } from "./MotionProvider";
import { motionTimings } from "./presets";

export function MotionIconSwap({
  stateKey,
  children,
  className,
}: {
  stateKey: string | number;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  const { reduceMotion, disableMotion } = useMotionLevel();
  const hidden = reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 };
  const visible = { opacity: 1, scale: 1 };
  const enterTransition = disableMotion ? { duration: 0 } : motionTimings.fast;
  const exitTransition = disableMotion ? { duration: 0 } : { duration: 0.1, ease: motionTimings.fast.ease };

  return (
    <span className={cn("inline-grid shrink-0", className)}>
      <AnimatePresence initial={false}>
        <motion.span
          key={stateKey}
          initial={disableMotion ? false : hidden}
          animate={{ ...visible, transition: enterTransition }}
          exit={{ ...hidden, transition: exitTransition }}
          className="col-start-1 row-start-1 inline-flex items-center justify-center"
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
