import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "../../lib/util";
import { useMotionLevel } from "./MotionProvider";
import { motionTimings } from "./presets";

type StableActivitySlotGeometry = "row" | "content";

/**
 * Keeps one activity position mounted while its semantic state changes.
 *
 * A short row uses one fixed geometry box and synchronously crossfades its
 * layers. A full execution projection uses content geometry and swaps in
 * place without a presence gap. Callers own the actual row and label; this
 * primitive only owns presence and geometry.
 */
export function StableActivitySlot({
  stateKey,
  children,
  className,
  geometry = "row",
  preserveChildAnimations = false,
}: {
  stateKey: string | number;
  children: ReactNode;
  className?: string;
  geometry?: StableActivitySlotGeometry;
  /** Keep child-owned continuous animations alive on the first presence mount. */
  preserveChildAnimations?: boolean;
}): JSX.Element {
  const { disableMotion } = useMotionLevel();
  // This slot is measured by the chat virtualizer. Keep state replacement
  // opacity-only so the activity row never visually hops while its parent is
  // being remeasured.
  const hidden = { opacity: 0 };
  const transition = disableMotion ? { duration: 0 } : motionTimings.chatSwitch;

  if (geometry === "content") {
    return (
      <div
        className={cn("senera-stable-activity-slot senera-stable-activity-slot--content", className)}
        data-stable-activity-slot
        data-stable-activity-geometry={geometry}
        data-stable-activity-state={String(stateKey)}
      >
        <div className="senera-stable-activity-slot__layer">{children}</div>
      </div>
    );
  }

  return (
    <div
      className={cn("senera-stable-activity-slot senera-stable-activity-slot--row", className)}
      data-stable-activity-slot
      data-stable-activity-geometry={geometry}
      data-stable-activity-state={String(stateKey)}
    >
      <AnimatePresence initial={preserveChildAnimations ? undefined : false} mode="sync">
        <motion.div
          key={stateKey}
          initial={preserveChildAnimations || disableMotion ? false : hidden}
          animate={{ opacity: 1 }}
          exit={hidden}
          transition={transition}
          className="senera-stable-activity-slot__layer"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
