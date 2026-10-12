import { AnimatePresence, motion } from "framer-motion";
import type { ChatMessage, RunRecord } from "../../store/sessionStore";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { AppIcon, Button, IconButton, Popover, PopoverContent, PopoverTrigger, Spinner } from "../../shared/ui";
import { motionTimings, useMotionLevel } from "../../shared/motion";

export interface SystemMessageRowProps {
  message: Pick<ChatMessage, "content" | "requestId" | "failure">;
  recoveryAttempt?: RunRecord["recoveryAttempt"];
  superseded?: boolean;
  onDismissed?: () => void;
  onRetry?: () => void;
  onContinue?: () => void;
}

export function SystemMessageRow({
  message,
  recoveryAttempt,
  superseded = false,
  onDismissed,
  onRetry,
  onContinue,
}: SystemMessageRowProps): JSX.Element {
  const { disableMotion, reduceMotion } = useMotionLevel();
  const pending = recoveryAttempt?.status === "pending";
  const summary = recoveryAttempt?.message ?? message.content;
  const status = pending
    ? frontendMessage(recoveryAttempt.mode === "retry" ? "chat.runFailure.retrying" : "chat.runFailure.continuing")
    : frontendMessage("chat.runFailure.title");
  const details =
    message.failure?.details === undefined ? message.content : JSON.stringify(message.failure.details, null, 2);

  return (
    <AnimatePresence initial={false} onExitComplete={onDismissed}>
      {!superseded ? (
        <motion.article
          key="recovery-notice"
          initial={false}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={disableMotion || reduceMotion ? { duration: 0 } : motionTimings.feedback}
          className="min-w-0 overflow-hidden text-content-primary"
          role={pending ? "status" : "alert"}
          aria-busy={pending || undefined}
          data-run-error
          data-recovery-status={pending ? "pending" : "ready"}
        >
          <div className="pb-3 pt-1">
            <div className="flex min-h-12 min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line-subtle bg-surface-subtle/50 px-3 py-2">
              <span className={pending ? "text-content-muted" : "text-brick-600 dark:text-brick-300"}>
                {pending ? <Spinner size="xs" /> : <AppIcon icon="warning" size={17} aria-hidden="true" />}
              </span>
              <div className="min-w-0 flex-1 basis-28">
                <p className="text-[12.5px] font-medium leading-5">{status}</p>
                {!pending && summary ? (
                  <p className="truncate text-[12px] leading-5 text-content-muted">{summary}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {!pending && message.requestId && onRetry ? (
                  <Button size="sm" variant="outline" onClick={onRetry} data-run-error-action="retry">
                    <AppIcon icon="refresh" size={14} aria-hidden="true" />
                    {frontendMessage("chat.runFailure.retry")}
                  </Button>
                ) : null}
                {!pending && message.requestId && onContinue ? (
                  <Button size="sm" variant="ghost" onClick={onContinue} data-run-error-action="continue">
                    {frontendMessage("chat.runFailure.continue")}
                    <AppIcon icon="arrow-right" size={14} aria-hidden="true" />
                  </Button>
                ) : null}
                {!pending ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <IconButton label={frontendMessage("chat.runFailure.details")}>
                        <AppIcon icon="info" size={16} />
                      </IconButton>
                    </PopoverTrigger>
                    <PopoverContent
                      side="top"
                      align="end"
                      className="w-[min(28rem,calc(100vw-2rem))]"
                      aria-label={frontendMessage("chat.runFailure.details")}
                    >
                      <p className="mb-2 text-xs font-medium">{frontendMessage("chat.runFailure.details")}</p>
                      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-content-secondary">
                        {details}
                      </pre>
                    </PopoverContent>
                  </Popover>
                ) : null}
              </div>
            </div>
          </div>
        </motion.article>
      ) : null}
    </AnimatePresence>
  );
}
