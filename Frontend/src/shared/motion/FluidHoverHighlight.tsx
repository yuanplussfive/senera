import { motion, type HTMLMotionProps, type Transition } from "framer-motion";
import { motionSprings } from "./presets";
import { useMotionLevel } from "./MotionLevelContext";
import type { FluidHoverItemRect, UseFluidHoverReturn } from "./useFluidHover";

export interface FluidHoverHighlightProps extends Omit<HTMLMotionProps<"div">, "children" | "transition"> {
  hover: Pick<UseFluidHoverReturn, "activeIndex" | "itemRects" | "isMeasured">;
  hidden?: boolean;
  /**
   * The wash this list paints. It is the only background source for the layer:
   * putting a `bg-*` utility in `className` instead would race the default in
   * the cascade, because both declarations have the same specificity and the
   * winner is decided by stylesheet order, not by class order.
   */
  surfaceClassName?: string;
  transition?: Transition | false;
}

function target(rect: FluidHoverItemRect): { x: number; y: number } {
  return { x: rect.left, y: rect.top };
}

function resolveTransition(
  transition: Transition | false | undefined,
  reduceMotion: boolean,
  disableMotion: boolean,
): Transition {
  if (disableMotion || transition === false) return { duration: 0 };
  const positional = reduceMotion ? { duration: 0 } : (transition ?? motionSprings.fluidHover);
  return { ...positional, opacity: { duration: 0.08 } };
}

/**
 * One hover layer per list. It is the only owner of the pointer-following
 * surface: the rects come from `useFluidHover`, so this component must not
 * measure or re-parent anything itself.
 *
 * The layer is a pure projection of the hovered index: it mounts when a row is
 * hovered, retargets by spring while the same row set stays hovered, and
 * unmounts when the pointer leaves. No presence animation runs on top of that,
 * because two children under an AnimatePresence overlapped for the exit window
 * (two translucent washes over the same rows) and re-entered from stale rects.
 */
export function FluidHoverHighlight({
  hover,
  hidden = false,
  surfaceClassName = "bg-surface-hover",
  className,
  style,
  transition,
  ...props
}: FluidHoverHighlightProps): JSX.Element | null {
  const { reduceMotion, disableMotion } = useMotionLevel();
  const rect =
    !hidden && hover.isMeasured && hover.activeIndex !== null ? (hover.itemRects[hover.activeIndex] ?? null) : null;
  if (!rect) return null;

  return (
    <motion.div
      {...props}
      aria-hidden="true"
      className={`pointer-events-none absolute left-0 top-0 z-0 ${surfaceClassName}${className ? ` ${className}` : ""}`}
      data-fluid-hover-highlight
      style={{ ...style, width: rect.width, height: rect.height }}
      initial={{ opacity: 0, ...target(rect) }}
      animate={{ opacity: 1, ...target(rect) }}
      transition={resolveTransition(transition, reduceMotion, disableMotion)}
    />
  );
}
