import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { useMotionLevel, motionTimings, readMessageItemVariants } from "../../shared/motion";

export function MotionMessageItem({
  children,
  motionKey,
  className,
  animateOnMount = true,
}: {
  children: ReactNode;
  motionKey: string;
  className?: string;
  animateOnMount?: boolean;
}): JSX.Element {
  const { level, reduceMotion, disableMotion } = useMotionLevel();
  const effectiveLevel = disableMotion ? "none" : reduceMotion ? "reduced" : level;

  return (
    <motion.div
      key={motionKey}
      variants={readMessageItemVariants(effectiveLevel)}
      initial={animateOnMount ? "hidden" : false}
      animate="show"
      exit="exit"
      transition={disableMotion ? { duration: 0 } : motionTimings.base}
      className={className ? `min-w-0 ${className}` : "min-w-0"}
    >
      {children}
    </motion.div>
  );
}
