import { useMemo } from "react";
import type { ModelProviderListItem } from "../../api/eventTypes";
import { useStore, type ChatMessage, type UserProfile, DEFAULT_SESSION_TITLE } from "../../store/sessionStore";
import { ChatComposer } from "./ChatComposer";
import { ChatHeader } from "./ChatHeader";
import { EmptyChatState } from "./EmptyChatState";
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
}: Props): JSX.Element {
  const activeId = useStore((s) => s.activeSessionId);
  const session = useStore((s) => (activeId ? s.sessions[activeId] : null));

  const messages = session?.messages ?? [];
  const currentRun = session?.runs[session.runs.length - 1];
  const isRunning = currentRun?.status === "running";
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
      {messages.length === 0 && !isRunning ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <EmptyChatState />
        </div>
      ) : (
        <MessageList
          sessionId={session?.sessionId ?? activeId ?? ""}
          messages={messages}
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
        disabled={socketStatus !== "open"}
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
