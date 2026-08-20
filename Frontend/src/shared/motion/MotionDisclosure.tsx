import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "../../lib/util";
import { useMotionLevel } from "./MotionProvider";
import { readDisclosureTransition, readDisclosureVariants } from "./presets";

export function MotionDisclosure({
  children,
  className,
  id,
  open,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  open: boolean;
}): JSX.Element {
  const { disableMotion, level, reduceMotion } = useMotionLevel();
  const effectiveLevel = disableMotion ? "none" : reduceMotion ? "reduced" : level;
  const variants = readDisclosureVariants(effectiveLevel);

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="disclosure-content"
          id={id}
          initial={disableMotion ? false : variants.hidden}
          animate={{ ...variants.show, transition: readDisclosureTransition(effectiveLevel) }}
          exit={{ ...variants.exit, transition: readDisclosureTransition(effectiveLevel, "exit") }}
          className={cn("min-w-0 overflow-hidden", className)}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
