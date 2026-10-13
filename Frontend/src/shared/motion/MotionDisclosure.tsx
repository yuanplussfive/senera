import { AnimatePresence, motion, type MotionProps } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "../../lib/util";
import { useMotionLevel } from "./MotionProvider";
import { readDisclosureTransition, readDisclosureVariants } from "./presets";

type MotionDisclosureStrategy = "animated" | "stable";

export function MotionDisclosure({
  children,
  className,
  id,
  open,
  layout,
  strategy = "animated",
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  open: boolean;
  layout?: MotionProps["layout"];
  strategy?: MotionDisclosureStrategy;
}): JSX.Element {
  const { disableMotion, level, reduceMotion } = useMotionLevel();
  const effectiveLevel = disableMotion ? "none" : reduceMotion ? "reduced" : level;

  if (strategy === "stable") {
    return (
      <div
        id={id}
        className={cn(
          "motion-disclosure--stable min-w-0 overflow-hidden",
          open && "motion-disclosure--stable-open",
          className,
        )}
        aria-hidden={!open}
        data-motion-disclosure-state={open ? "open" : "closed"}
      >
        <div className="motion-disclosure--stable__inner">{children}</div>
      </div>
    );
  }

  const variants = readDisclosureVariants(effectiveLevel);

  return (
    <AnimatePresence initial={false} mode="sync">
      {open ? (
        <motion.div
          key="disclosure-content"
          id={id}
          initial={disableMotion ? false : variants.hidden}
          animate={{ ...variants.show, transition: readDisclosureTransition(effectiveLevel) }}
          exit={{ ...variants.exit, transition: readDisclosureTransition(effectiveLevel, "exit") }}
          layout={effectiveLevel === "full" ? layout : false}
          className={cn("min-w-0 overflow-hidden", className)}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
