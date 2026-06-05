import { useMemo } from "react";
import type { ModelProviderListItem } from "../../api/eventTypes";
import { useStore, type ChatMessage, type UserProfile, DEFAULT_SESSION_TITLE } from "../../store/sessionStore";
import { ChatComposer } from "./ChatComposer";
import { ChatHeader } from "./ChatHeader";
import { EmptyChatState } from "./EmptyChatState";
import { HistoryRecoveryState } from "./HistoryRecoveryState";
import { MessageList } from "./MessageList";
import { readSelectedModelProvider } from "./modelProvider";

interface Props {
  modelProviders: ModelProviderListItem[];
  selectedModelProviderId: string | null;
  onSelectModelProvider: (id: string) => void;
  socketStatus: string;
  onSend: (input: string) => void;
  onCancel: () => void;
  onRegenerate: (message: ChatMessage) => void;
  onEditUserMessage: (message: ChatMessage, nextContent: string) => void;
  onDeleteFromMessage: (message: ChatMessage) => void;
  onViewWorkflow: (message: ChatMessage) => void;
  userProfile: UserProfile;
  onOpenSessionPanel?: () => void;
  onOpenWorkflowPanel?: () => void;
  onRetryHistory?: (sessionId: string) => void;
}

export function ChatPanel({
  modelProviders,
  selectedModelProviderId,
  onSelectModelProvider,
  socketStatus,
  onSend,
  onCancel,
  onRegenerate,
  onEditUserMessage,
  onDeleteFromMessage,
  onViewWorkflow,
  userProfile,
  onOpenSessionPanel,
  onOpenWorkflowPanel,
  onRetryHistory,
}: Props): JSX.Element {
  const activeId = useStore((s) => s.activeSessionId);
  const session = useStore((s) => (activeId ? s.sessions[activeId] : null));
  const historyLoading = useStore((s) => (activeId ? !!s.historyLoadingIds[activeId] : false));
  const historyFailed = useStore((s) => (activeId ? !!s.historyFailedIds[activeId] : false));

  const messages = session?.messages ?? [];
  const currentRun = session?.runs[session.runs.length - 1];
  const isRunning = currentRun?.status === "running";
  const composerDisabled = socketStatus !== "open" || historyLoading;
  const shouldShowHistoryRecovery =
    messages.length === 0 &&
    !isRunning &&
    !!session &&
    session.messageCount > 0 &&
    (historyLoading || historyFailed);
  const assistantAvatarIcon = useMemo(
    () => readSelectedModelProvider(modelProviders, selectedModelProviderId)?.icon,
    [modelProviders, selectedModelProviderId],
  );
  const selectedModelProvider = useMemo(
    () => readSelectedModelProvider(modelProviders, selectedModelProviderId),
    [modelProviders, selectedModelProviderId],
  );

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-paper-50">
      <ChatHeader
        title={session?.title ?? DEFAULT_SESSION_TITLE}
        runStatus={currentRun?.status}
        onOpenSessionPanel={onOpenSessionPanel}
        onOpenWorkflowPanel={onOpenWorkflowPanel}
      />
      {shouldShowHistoryRecovery ? (
        <HistoryRecoveryState
          failed={historyFailed}
          messageCount={session.messageCount}
          onRetry={activeId && onRetryHistory ? () => onRetryHistory(activeId) : undefined}
          retryDisabled={socketStatus !== "open"}
        />
      ) : messages.length === 0 && !isRunning ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <EmptyChatState
            onSelectSuggestion={socketStatus === "open" ? onSend : undefined}
          />
        </div>
      ) : (
        <MessageList
          sessionId={session?.sessionId ?? activeId ?? ""}
          messages={messages}
          runs={session?.runs ?? []}
          currentRun={isRunning ? currentRun : undefined}
          assistantAvatarIcon={assistantAvatarIcon}
          selectedModelProvider={selectedModelProvider}
          userProfile={userProfile}
          onRegenerate={onRegenerate}
          onEditUserMessage={onEditUserMessage}
          onDeleteFromMessage={onDeleteFromMessage}
          onViewWorkflow={onViewWorkflow}
        />
      )}
      <ChatComposer
        disabled={composerDisabled}
        running={!!isRunning}
        modelProviders={modelProviders}
        selectedModelProviderId={selectedModelProviderId}
        onSelectModelProvider={onSelectModelProvider}
        socketStatus={socketStatus}
        onSend={onSend}
        onCancel={onCancel}
      />
    </main>
  );
}
