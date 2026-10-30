import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { ErrorBanner, RetryButton } from "../../shared/ui";
import { ConversationSkeleton } from "./ConversationSkeleton";

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
          <ErrorBanner
            title={frontendMessage("session.historyFailedTitle")}
            description={frontendMessage("session.historyFailedDescription")}
            action={
              retryDisabled ? (
                <span role="status" className="shrink-0 text-[12px] font-medium text-ink-500">
                  {frontendMessage("session.historyWaitingForConnection")}
                </span>
              ) : onRetry ? (
                <RetryButton onRetry={onRetry} label={frontendMessage("session.historyRetry")} />
              ) : undefined
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      role="status"
      aria-busy="true"
      aria-label={frontendMessage("session.historyRestoring", { count: messageCount })}
      data-history-skeleton
    >
      <ConversationSkeleton />
    </div>
  );
}
