import { motion } from "framer-motion";
import type { HTMLMotionProps } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "../../lib/util";
import { useMotionLevel } from "./MotionProvider";
import { motionTimings, readTapScale } from "./presets";

export function MotionButton({
  children,
  className,
  type = "button",
  ...props
}: HTMLMotionProps<"button"> & {
  children: ReactNode;
}): JSX.Element {
  const { level, reduceMotion, disableMotion } = useMotionLevel();
  const tapScale = readTapScale(disableMotion || reduceMotion ? "reduced" : level);
  return (
    <motion.button
      type={type}
      whileTap={tapScale ? { scale: tapScale } : undefined}
      transition={motionTimings.fast}
      className={cn(className)}
      {...props}
    >
      {children}
    </motion.button>
  );
}
