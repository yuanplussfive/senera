import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { readActiveRun, useStore, DEFAULT_SESSION_TITLE } from "../../store/sessionStore";
import type { ChatMessage, RunRecord } from "../../store/sessionStore";
import { useChatState } from "../../store/selectors/chatSelectors";
import { ErrorBoundary } from "../../shared/ui";
import { ChatComposer } from "./ChatComposer";
import { ChatActivityDock } from "./ChatActivityDock";
import { ChatHeader } from "./ChatHeader";
import { EmptyChatState } from "./EmptyChatState";
import { HistoryRecoveryState } from "./HistoryRecoveryState";
import { MessageList } from "./MessageList";
import { UploadPreviewProvider } from "./UploadPreviewRegistry";
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
  const [composerValue, setComposerValue] = useState("");
  const activeId = useStore((s) => s.activeSessionId);
  const approvalMode = useStore((s) => s.executionApprovalMode);
  const setApprovalMode = useStore((s) => s.setExecutionApprovalMode);
  const { session, historyLoaded, historyLoading, historyFailed } = useChatState(activeId);
  const { level, reduceMotion, disableMotion } = useMotionLevel();
  const effectiveMotionLevel = disableMotion ? "none" : reduceMotion ? "reduced" : level;
  const messages = session?.messages ?? [];
  const runs = session?.runs ?? [];
  const hasConversationContent = hasRenderableConversationContent(messages, runs);
  const currentRun = readActiveRun(session ?? undefined);
  const isRunning = currentRun?.status === "running";
  const isSettling = isRunning && (currentRun.outputState === "available" || currentRun.outputState === "committed");
  const isCancelling = currentRun?.status === "cancelling";
  const isActive = isRunning || isCancelling;
  const composerDisabled = runtime.socketStatus !== "open" || historyLoading || isCancelling;
  const shouldShowHistoryRecovery =
    messages.length === 0 &&
    !hasConversationContent &&
    !isActive &&
    !!session &&
    session.messageCount > 0 &&
    (!historyLoaded || historyLoading || historyFailed);
  return (
    <UploadPreviewProvider>
      <main className="flex h-full min-w-0 flex-1 flex-col bg-transparent" data-agent-workspace>
        <ChatHeader
          title={session?.title ?? DEFAULT_SESSION_TITLE}
          runStatus={currentRun?.status}
          waitingForApproval={currentRun?.activeFlags?.includes("waiting_for_approval") === true}
          waitingForInput={currentRun?.activeFlags?.includes("waiting_for_input") === true}
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
          ) : !hasConversationContent && !isActive ? (
            <ChatContentMotion key={`empty:${activeId ?? "none"}`} motionLevel={effectiveMotionLevel}>
              <div className="flex flex-1 items-center justify-center px-8 py-16 sm:px-12">
                <EmptyChatState onSelectSuggestion={runtime.socketStatus === "open" ? setComposerValue : undefined} />
              </div>
            </ChatContentMotion>
          ) : (
            <ChatContentMotion key={`messages:${activeId ?? "none"}`} motionLevel={effectiveMotionLevel}>
              <ErrorBoundary resetKey={activeId}>
                <MessageList
                  sessionId={session?.sessionId ?? activeId ?? ""}
                  uploadUrl={runtime.uploadUrl}
                  messages={messages}
                  runs={runs}
                  currentRun={isActive ? currentRun : undefined}
                  userProfile={userProfile}
                  onForkFromMessage={messageActions.onForkFromMessage}
                  onRegenerate={messageActions.onRegenerate}
                  onEditUserMessage={messageActions.onEditUserMessage}
                  onDeleteFromMessage={messageActions.onDeleteFromMessage}
                  onViewWorkflow={messageActions.onViewWorkflow}
                  onResolveInteractionInput={messageActions.onResolveInteractionInput}
                />
              </ErrorBoundary>
            </ChatContentMotion>
          )}
        </AnimatePresence>
        <ChatActivityDock
          sessionId={activeId ?? undefined}
          runs={runs}
          approvalDisabled={runtime.socketStatus !== "open"}
          onResolveApproval={messageActions.onResolveApproval}
          onResolveApprovalBatch={messageActions.onResolveApprovalBatch}
        />
        <ChatComposer
          disabled={composerDisabled}
          running={!!isRunning}
          settling={!!isSettling}
          cancelling={!!isCancelling}
          value={composerValue}
          onValueChange={setComposerValue}
          modelConfig={modelConfig}
          activeSessionId={activeId}
          approvalConfig={{ mode: approvalMode, onSelectMode: setApprovalMode }}
          presetConfig={presetConfig}
          runtime={{
            socketStatus: runtime.socketStatus,
            uploadUrl: runtime.uploadUrl,
            uploadCsrfToken: runtime.uploadCsrfToken,
          }}
          onSend={messageActions.onSend}
          onCancel={messageActions.onCancel}
          onOpenSettings={navigationActions?.onOpenSettings}
        />
      </main>
    </UploadPreviewProvider>
  );
}

export function hasRenderableConversationContent(
  messages: readonly ChatMessage[],
  runs: readonly RunRecord[],
): boolean {
  return messages.length > 0 || runs.length > 0;
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
