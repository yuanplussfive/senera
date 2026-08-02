import { AlertCircle } from "lucide-react";
import { cn } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
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
            {retryDisabled ? (
              <span role="status" className="shrink-0 text-[12px] font-medium text-ink-500">
                {frontendMessage("session.historyWaitingForConnection")}
              </span>
            ) : onRetry ? (
              <RetryButton onRetry={onRetry} label={frontendMessage("session.historyRetry")} />
            ) : null}
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
          <HistorySkeletonRow key={index} index={index} role={index % 2 === 0 ? "user" : "assistant"} />
        ))}
      </div>
    </div>
  );
}

function HistorySkeletonRow({ role, index }: { role: "user" | "assistant"; index: number }): JSX.Element {
  return role === "user" ? <UserMessageSkeleton index={index} /> : <AssistantMessageSkeleton index={index} />;
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
