import { ArrowDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { motionSprings, motionTimings, useMotionLevel } from "../../shared/motion";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";

interface ScrollToBottomButtonProps {
  visible: boolean;
  onClick: () => void;
}

export function ScrollToBottomButton({ visible, onClick }: ScrollToBottomButtonProps): JSX.Element {
  const { reduceMotion, disableMotion } = useMotionLevel();
  const motionInitial = disableMotion ? false : reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.95 };
  const motionAnimate = reduceMotion || disableMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 };
  const motionExit = disableMotion ? undefined : reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.95 };
  const transition = disableMotion ? { duration: 0 } : reduceMotion ? motionTimings.fast : motionSprings.snappy;

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
            className="grid h-8 w-8 place-items-center rounded-full border border-line-subtle bg-surface-raised text-content-secondary shadow-[0_2px_8px_-4px_rgb(24_25_28/0.22)] transition-colors duration-150 hover:bg-surface-hover hover:text-content-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
            aria-label={frontendMessage("chat.scrollToBottom")}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </motion.button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
