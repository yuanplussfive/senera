import { AnimatePresence, motion } from "framer-motion";
import { useStore, DEFAULT_SESSION_TITLE } from "../../store/sessionStore";
import { useChatState } from "../../store/selectors/chatSelectors";
import { ErrorBoundary } from "../../shared/ui";
import { ChatComposer } from "./ChatComposer";
import { ChatHeader } from "./ChatHeader";
import { EmptyChatState } from "./EmptyChatState";
import { HistoryRecoveryState } from "./HistoryRecoveryState";
import { MessageList } from "./MessageList";
import { motionTimings, useMotionLevel, type MotionLevel } from "../../shared/motion";
import type { ChatPanelProps } from "./ChatPanelContracts";

export function ChatPanel({
  userProfile,
  modelConfig,
  presetConfig,
  runtime,
  messageActions,
  navigationActions,
}: ChatPanelProps): JSX.Element {
  const activeId = useStore((s) => s.activeSessionId);
  const { session, historyLoaded, historyLoading, historyFailed } = useChatState(activeId);
  const { level, reduceMotion, disableMotion } = useMotionLevel();
  const effectiveMotionLevel = disableMotion ? "none" : reduceMotion ? "reduced" : level;

  const messages = session?.messages ?? [];
  const currentRun = session?.runs[session.runs.length - 1];
  const isRunning = currentRun?.status === "running";
  const composerDisabled = runtime.socketStatus !== "open" || historyLoading;
  const shouldShowHistoryRecovery =
    messages.length === 0 &&
    !isRunning &&
    !!session &&
    session.messageCount > 0 &&
    (!historyLoaded || historyLoading || historyFailed);
  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-surface-canvas" data-agent-workspace>
      <ChatHeader
        title={session?.title ?? DEFAULT_SESSION_TITLE}
        runStatus={currentRun?.status}
        sandboxStatus={runtime.sandboxStatus}
        onOpenSessionPanel={navigationActions?.onOpenSessionPanel}
        onOpenWorkflowPanel={navigationActions?.onOpenWorkflowPanel}
      />
      <AnimatePresence mode="wait" initial={false}>
        {shouldShowHistoryRecovery ? (
          <ChatContentMotion
            key={`history:${activeId}:${historyFailed ? "failed" : "loading"}`}
            motionLevel={effectiveMotionLevel}
          >
            <HistoryRecoveryState
              failed={historyFailed}
              messageCount={session.messageCount}
              onRetry={
                activeId && navigationActions?.onRetryHistory
                  ? () => navigationActions.onRetryHistory?.(activeId)
                  : undefined
              }
              retryDisabled={runtime.socketStatus !== "open"}
            />
          </ChatContentMotion>
        ) : messages.length === 0 && !isRunning ? (
          <ChatContentMotion key={`empty:${activeId ?? "none"}`} motionLevel={effectiveMotionLevel}>
            <div className="flex flex-1 items-center justify-center px-8 py-16 sm:px-12">
              <EmptyChatState
                onSelectSuggestion={runtime.socketStatus === "open" ? messageActions.onSend : undefined}
              />
            </div>
          </ChatContentMotion>
        ) : (
          <ChatContentMotion key={`messages:${activeId ?? "none"}`} motionLevel={effectiveMotionLevel}>
            <ErrorBoundary resetKey={activeId}>
              <MessageList
                sessionId={session?.sessionId ?? activeId ?? ""}
                messages={messages}
                runs={session?.runs ?? []}
                currentRun={isRunning ? currentRun : undefined}
                userProfile={userProfile}
                onRegenerate={messageActions.onRegenerate}
                onEditUserMessage={messageActions.onEditUserMessage}
                onDeleteFromMessage={messageActions.onDeleteFromMessage}
                onViewWorkflow={messageActions.onViewWorkflow}
                onResolveApproval={messageActions.onResolveApproval}
                approvalDisabled={runtime.socketStatus !== "open"}
              />
            </ErrorBoundary>
          </ChatContentMotion>
        )}
      </AnimatePresence>
      <ChatComposer
        disabled={composerDisabled}
        running={!!isRunning}
        modelConfig={modelConfig}
        presetConfig={presetConfig}
        runtime={{
          socketStatus: runtime.socketStatus,
          uploadUrl: runtime.uploadUrl,
        }}
        onSend={messageActions.onSend}
        onCancel={messageActions.onCancel}
      />
    </main>
  );
}

function ChatContentMotion({
  children,
  motionLevel,
}: {
  children: JSX.Element;
  motionLevel: MotionLevel;
}): JSX.Element {
  return (
    <motion.div
      className="flex min-h-0 flex-1 flex-col"
      initial={motionLevel === "none" ? false : "hidden"}
      animate="show"
      exit="exit"
      variants={readChatContentVariants(motionLevel)}
      transition={motionLevel === "none" ? { duration: 0 } : motionTimings.base}
    >
      {children}
    </motion.div>
  );
}

function readChatContentVariants(level: MotionLevel) {
  if (level === "none") {
    return {
      hidden: { opacity: 1 },
      show: { opacity: 1 },
      exit: { opacity: 1 },
    };
  }
  if (level === "reduced") {
    return {
      hidden: { opacity: 0 },
      show: { opacity: 1 },
      exit: { opacity: 0 },
    };
  }
  return {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
  };
}
