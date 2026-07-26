import { motion } from "framer-motion";
import { AlertCircle } from "lucide-react";
import { cn } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { motionTimings, useMotionLevel, type MotionLevel } from "../../shared/motion";
import { ConversationFrame, RetryButton, Skeleton } from "../../shared/ui";

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
            {onRetry ? <RetryButton onRetry={onRetry} disabled={retryDisabled} /> : null}
          </div>
        </div>
      </div>
    );
  }

  const rows = Math.min(6, Math.max(1, messageCount || 5));
  return (
    <div
      className="flex flex-1 flex-col justify-end overflow-hidden pb-5 pt-6"
      role="status"
      aria-busy="true"
      aria-label={frontendMessage("session.historyRestoring", { count: messageCount })}
      data-history-skeleton
    >
      <div className="flex w-full flex-col gap-4">
        {Array.from({ length: rows }).map((_, index) => (
          <HistorySkeletonRow
            key={index}
            index={index}
            role={index % 2 === 0 ? "user" : "assistant"}
            motionLevel={effectiveMotionLevel}
          />
        ))}
      </div>
    </div>
  );
}

function HistorySkeletonRow({
  role,
  index,
  motionLevel,
}: {
  role: "user" | "assistant";
  index: number;
  motionLevel: MotionLevel;
}): JSX.Element {
  const isUser = role === "user";
  return (
    <motion.div
      initial={motionLevel === "none" ? false : "hidden"}
      animate="show"
      variants={readHistoryRowVariants(motionLevel, isUser)}
      transition={motionLevel === "none" ? { duration: 0 } : { ...motionTimings.base, delay: index * 0.045 }}
    >
      {isUser ? <UserMessageSkeleton index={index} /> : <AssistantMessageSkeleton index={index} />}
    </motion.div>
  );
}

function UserMessageSkeleton({ index }: { index: number }): JSX.Element {
  return (
    <ConversationFrame mode="user" className="items-start justify-end gap-2.5" aria-hidden="true">
      <div className={cn("flex flex-col items-end", index % 4 === 0 ? "w-[46%]" : "w-[58%]")}>
        <Skeleton className="h-11 w-full rounded-2xl rounded-tr-[5px]" />
      </div>
      <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
    </ConversationFrame>
  );
}

function AssistantMessageSkeleton({ index }: { index: number }): JSX.Element {
  return (
    <ConversationFrame mode="wide" aria-hidden="true">
      <div className="flex min-w-0 items-start gap-3">
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
        <div className={cn("min-w-0 flex-1", index % 4 === 1 ? "max-w-[72%]" : "max-w-[82%]")}>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-[88%]" />
          <Skeleton className="mt-2 h-3 w-[62%]" />
        </div>
      </div>
    </ConversationFrame>
  );
}

function readHistoryRowVariants(level: MotionLevel, isUser: boolean) {
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
    hidden: { opacity: 0, x: isUser ? 8 : -8, y: 3 },
    show: { opacity: 1, x: 0, y: 0 },
  };
}
