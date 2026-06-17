import { ArrowDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { motionSprings, motionTimings, useMotionLevel } from "../../shared/motion";

interface ScrollToBottomButtonProps {
  visible: boolean;
  onClick: () => void;
}

export function ScrollToBottomButton({ visible, onClick }: ScrollToBottomButtonProps): JSX.Element {
  const { reduceMotion, disableMotion } = useMotionLevel();
  const motionInitial = disableMotion
    ? false
    : reduceMotion
      ? { opacity: 0 }
      : { opacity: 0, y: 10, scale: 0.95 };
  const motionAnimate = reduceMotion || disableMotion
    ? { opacity: 1 }
    : { opacity: 1, y: 0, scale: 1 };
  const motionExit = disableMotion
    ? undefined
    : reduceMotion
      ? { opacity: 0 }
      : { opacity: 0, y: 10, scale: 0.95 };
  const transition = disableMotion
    ? { duration: 0 }
    : reduceMotion
      ? motionTimings.fast
      : motionSprings.snappy;

  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.div
          initial={disableMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={disableMotion ? undefined : { opacity: 0 }}
          transition={transition}
          className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2"
        >
          <motion.button
            initial={motionInitial}
            animate={motionAnimate}
            exit={motionExit}
            transition={transition}
            onClick={onClick}
            className="flex h-9 items-center gap-1.5 rounded-full bg-ink-900/90 px-3.5 text-[13px] font-medium text-paper-50 shadow-lg ring-1 ring-ink-900/10 backdrop-blur-sm transition hover:bg-ink-800 focus:outline-none focus:ring-2 focus:ring-terra-300"
            aria-label="滚动到底部"
          >
            <ArrowDown className="h-4 w-4" />
            回到底部
          </motion.button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
