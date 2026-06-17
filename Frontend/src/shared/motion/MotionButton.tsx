import { motion } from "framer-motion";
import type { HTMLMotionProps } from "framer-motion";
import { forwardRef, type ReactNode } from "react";
import { cn } from "../../lib/util";
import { useMotionLevel } from "./MotionProvider";
import { motionTimings, readTapScale } from "./presets";

export const MotionButton = forwardRef<HTMLButtonElement, HTMLMotionProps<"button"> & { children: ReactNode }>(
  ({ children, className, type = "button", ...props }, ref) => {
    const { level, reduceMotion, disableMotion } = useMotionLevel();
    const tapScale = readTapScale(disableMotion || reduceMotion ? "reduced" : level);
    return (
      <motion.button
        ref={ref}
        type={type}
        whileTap={tapScale ? { scale: tapScale } : undefined}
        transition={motionTimings.fast}
        className={cn(className)}
        {...props}
      >
        {children}
      </motion.button>
    );
  },
);
MotionButton.displayName = "MotionButton";
