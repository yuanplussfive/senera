import { motion } from "framer-motion";
import { AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { motionTimings, useMotionLevel, type MotionLevel } from "../../shared/motion";
import { Button } from "../../shared/ui";

export function HistoryRecoveryState({
  failed,
  messageCount,
  onRetry,
  retryDisabled = false,
}: {
  failed: boolean;
  messageCount: number;
  onRetry?: () => void;
  retryDisabled?: boolean;
}): JSX.Element {
  const { level, reduceMotion, disableMotion } = useMotionLevel();
  const effectiveMotionLevel = disableMotion ? "none" : reduceMotion ? "reduced" : level;

  if (failed) {
    return (
      <div className="flex flex-1 flex-col justify-end px-4 pb-8 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-start gap-3 rounded-md border border-brick-200/60 bg-brick-50/40 px-3 py-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-brick-600" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-ink-900">
                {frontendMessage("session.historyFailedTitle")}
              </div>
              <p className="mt-0.5 text-[12.5px] leading-5 text-ink-500">
                {frontendMessage("session.historyFailedDescription")}
              </p>
            </div>
            {onRetry ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry}
                disabled={retryDisabled}
                className="h-7 gap-1 rounded-md px-2 text-[12px]"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {frontendMessage("ui.retry")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const rows = Math.min(4, Math.max(2, Math.ceil(messageCount / 3)));
  return (
    <div className="flex flex-1 flex-col justify-end px-4 pb-8 sm:px-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        {Array.from({ length: rows }).map((_, index) => (
          <HistorySkeletonRow
            key={index}
            index={index}
            align={index % 2 === 0 ? "right" : "left"}
            width={index % 2 === 0 ? "w-[54%]" : "w-[68%]"}
            motionLevel={effectiveMotionLevel}
          />
        ))}
        <div
          className="mt-1 flex items-center justify-center gap-2 text-center text-[12px] text-ink-400"
          role="status"
          aria-live="polite"
        >
          <LoadingDots motionLevel={effectiveMotionLevel} />
          <span>{frontendMessage("session.historyRestoring", { count: messageCount })}</span>
        </div>
      </div>
    </div>
  );
}

function HistorySkeletonRow({
  align,
  width,
  index,
  motionLevel,
}: {
  align: "left" | "right";
  width: string;
  index: number;
  motionLevel: MotionLevel;
}): JSX.Element {
  const isRight = align === "right";
  return (
    <motion.div
      className={isRight ? "flex justify-end" : "flex justify-start"}
      initial={motionLevel === "none" ? false : "hidden"}
      animate="show"
      variants={readHistoryRowVariants(motionLevel, isRight)}
      transition={motionLevel === "none" ? { duration: 0 } : { ...motionTimings.base, delay: index * 0.045 }}
    >
      <div className={`${width} min-w-[180px] max-w-[520px]`}>
        <div
          className={cn(
            "shimmer rounded-2xl",
            isRight ? "ml-auto h-10 rounded-br-md bg-ink-800/20" : "h-16 rounded-bl-md bg-ink-700/25",
          )}
        />
        <div className={cn("mt-1 h-2 rounded bg-ink-800/15", isRight ? "ml-auto w-16" : "w-20")} />
      </div>
    </motion.div>
  );
}

function LoadingDots({ motionLevel }: { motionLevel: MotionLevel }): JSX.Element {
  return (
    <span
      className={cn(
        "thinking-loader inline-flex h-4 items-center gap-1",
        motionLevel === "none" && "thinking-loader--static",
      )}
      aria-hidden="true"
      data-motion-level={motionLevel}
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="thinking-loader-dot block h-1.5 w-1.5 rounded-full bg-terra-500/75"
          style={{ animationDelay: `${index * 140}ms` }}
        />
      ))}
    </span>
  );
}

function readHistoryRowVariants(level: MotionLevel, isRight: boolean) {
  if (level === "none") {
    return {
      hidden: { opacity: 1 },
      show: { opacity: 1 },
    };
  }
  if (level === "reduced") {
    return {
      hidden: { opacity: 0 },
      show: { opacity: 1 },
    };
  }
  return {
    hidden: { opacity: 0, x: isRight ? 12 : -12, y: 4 },
    show: { opacity: 1, x: 0, y: 0 },
  };
}
