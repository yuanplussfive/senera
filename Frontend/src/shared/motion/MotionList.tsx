import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "../../lib/util";
import { useMotionLevel } from "./MotionProvider";
import { readListItemVariants, readListTransition } from "./presets";

export function MotionList({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <motion.div className={className} initial={false}>
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </motion.div>
  );
}

export function MotionListItem({
  children,
  className,
  layout = false,
  initial = "hidden",
}: {
  children: ReactNode;
  className?: string;
  layout?: false | "position";
  initial?: false | "hidden";
}): JSX.Element {
  const { level, reduceMotion, disableMotion } = useMotionLevel();
  const effectiveLevel = disableMotion ? "none" : reduceMotion ? "reduced" : level;

  return (
    <motion.div
      layout={reduceMotion || disableMotion ? false : layout}
      variants={readListItemVariants(effectiveLevel)}
      initial={initial}
      animate="show"
      exit="exit"
      transition={readListTransition(effectiveLevel)}
      className={cn("min-w-0", className)}
    >
      {children}
    </motion.div>
  );
}
