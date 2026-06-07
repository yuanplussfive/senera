import { motion } from "framer-motion";
import type { HTMLMotionProps } from "framer-motion";
import { forwardRef } from "react";
import {
  motionSprings,
  motionTimings,
  readDialogPanelTransition,
  readDialogPanelVariants,
  readDrawerVariants,
  readOverlayVariants,
  type DialogMotionPreset,
} from "./presets";
import { useMotionLevel } from "./MotionProvider";

type RadixMotionProps = {
  "data-state"?: string;
};
type MotionDialogOverlayProps = HTMLMotionProps<"div"> & RadixMotionProps;
type MotionDialogContentProps = HTMLMotionProps<"div"> & {
  motionPreset?: DialogMotionPreset;
} & RadixMotionProps;
type MotionSheetContentProps = HTMLMotionProps<"div"> & {
  side?: "left" | "right";
} & RadixMotionProps;
type RadixPresenceState = "open" | "closed";

function readRadixState(props: { "data-state"?: string }): RadixPresenceState {
  return props["data-state"] === "closed" ? "closed" : "open";
}

export const MotionDialogOverlay = forwardRef<HTMLDivElement, MotionDialogOverlayProps>(
  ({ style, ...props }, ref) => {
    const { level, reduceMotion, disableMotion } = useMotionLevel();
    const effectiveLevel = disableMotion ? "none" : reduceMotion ? "reduced" : level;
    const state = readRadixState(props);
    const pointerEvents = state === "closed" ? "none" : style?.pointerEvents;
    return (
      <motion.div
        ref={ref}
        variants={readOverlayVariants(effectiveLevel)}
        initial={false}
        animate={state === "closed" ? "exit" : "show"}
        transition={disableMotion ? { duration: 0 } : motionTimings.fast}
        style={{ ...style, pointerEvents }}
        {...props}
      />
    );
  },
);
MotionDialogOverlay.displayName = "MotionDialogOverlay";

export const MotionDialogContent = forwardRef<HTMLDivElement, MotionDialogContentProps>(
  ({ initial = "hidden", motionPreset = "modal", style, transition, variants, ...props }, ref) => {
    const { level, reduceMotion, disableMotion } = useMotionLevel();
    const effectiveLevel = disableMotion ? "none" : reduceMotion ? "reduced" : level;
    const state = readRadixState(props);
    const defaultVariants = readDialogPanelVariants(effectiveLevel, motionPreset);
    const animationState = state === "closed" ? "exit" : "show";
    const usesCustomVariants = variants !== undefined;
    const pointerEvents = state === "closed" ? "none" : style?.pointerEvents;
    return (
      <motion.div
        ref={ref}
        variants={usesCustomVariants ? variants : undefined}
        initial={usesCustomVariants ? initial : initial === false ? false : defaultVariants.hidden}
        animate={usesCustomVariants ? animationState : defaultVariants[animationState]}
        transition={transition ?? readDialogPanelTransition(effectiveLevel, motionPreset)}
        style={{ ...style, pointerEvents }}
        {...props}
      />
    );
  },
);
MotionDialogContent.displayName = "MotionDialogContent";

export const MotionSheetContent = forwardRef<HTMLDivElement, MotionSheetContentProps>(
  ({ side = "right", ...props }, ref) => {
    const { level, reduceMotion, disableMotion } = useMotionLevel();
    const effectiveLevel = disableMotion ? "none" : reduceMotion ? "reduced" : level;
    const state = readRadixState(props);
    return (
      <motion.div
        ref={ref}
        variants={readDrawerVariants(effectiveLevel, side)}
        initial={false}
        animate={state === "closed" ? "exit" : "show"}
        transition={disableMotion ? { duration: 0 } : reduceMotion ? motionTimings.base : motionSprings.drawer}
        style={{ pointerEvents: state === "closed" ? "none" : undefined, ...props.style }}
        {...props}
      />
    );
  },
);
MotionSheetContent.displayName = "MotionSheetContent";
