import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "../../lib/util";
import { useMotionLevel } from "./MotionProvider";
import { readListItemVariants, readListTransition, readStagger } from "./presets";

export function MotionList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <motion.div className={className} initial={false}>
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </motion.div>
  );
}

export function MotionListItem({
  children,
  className,
  index = 0,
  itemCount = 1,
  layout = false,
}: {
  children: ReactNode;
  className?: string;
  index?: number;
  itemCount?: number;
  layout?: false | "position";
}): JSX.Element {
  const { level, reduceMotion, disableMotion } = useMotionLevel();
  const effectiveLevel = disableMotion ? "none" : reduceMotion ? "reduced" : level;
  const stagger = readStagger(itemCount);
  const delay = disableMotion ? 0 : index * stagger;

  return (
    <motion.div
      layout={reduceMotion || disableMotion ? false : layout}
      variants={readListItemVariants(effectiveLevel)}
      initial="hidden"
      animate="show"
      exit="exit"
      transition={readListTransition(effectiveLevel, delay)}
      className={cn("min-w-0", className)}
    >
      {children}
    </motion.div>
  );
}
