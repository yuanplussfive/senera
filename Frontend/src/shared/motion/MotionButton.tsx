import { motion } from "framer-motion";
import type { HTMLMotionProps } from "framer-motion";
import { forwardRef, type ReactNode } from "react";
import { cn } from "../../lib/util";
import { useMotionLevel } from "./MotionProvider";
import { motionTimings, readTapScale } from "./presets";

type OverlayAnchorProps = {
  readonly "data-overlay-anchor"?: string;
};

export const MotionButton = forwardRef<
  HTMLButtonElement,
  HTMLMotionProps<"button"> & OverlayAnchorProps & { children: ReactNode }
>(({ children, className, type = "button", "data-overlay-anchor": overlayAnchor, whileTap, ...props }, ref) => {
  const { level, reduceMotion, disableMotion } = useMotionLevel();
  const tapScale = readTapScale(disableMotion || reduceMotion ? "reduced" : level);
  return (
    <motion.button
      ref={ref}
      type={type}
      data-overlay-anchor={overlayAnchor}
      whileTap={overlayAnchor ? undefined : (whileTap ?? (tapScale ? { scale: tapScale } : undefined))}
      transition={motionTimings.fast}
      className={cn(className)}
      {...props}
    >
      {children}
    </motion.button>
  );
});
MotionButton.displayName = "MotionButton";
