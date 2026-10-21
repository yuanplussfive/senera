import type { ChatMessage, ConversationIdentity, RunRecord, UserProfile } from "../../store/sessionStore";
import { DEFAULT_ASSISTANT_PROFILE } from "../../store/session/userProfile";
import { cn } from "../../lib/util";
import { ConversationFrame } from "../../shared/ui";
import { AssistantMessageAvatar, MessageMeta } from "./MessageChrome";
import { MessageActions } from "./MessageActions";
import { readAssistantDisplayContent } from "./messagePresentation";
import { AssistantMessageBody } from "./AssistantMessageBody";
import { SystemMessageRow } from "./SystemMessageRow";
import { RunThinkingPresentation } from "./ModelThinkingDisclosure";
import { UserMessageRow } from "./UserMessageRow";
import { MessageMetrics } from "./MessageMetrics";

interface MessageRowProps {
  message: ChatMessage;
  run?: RunRecord;
  uploadUrl: string;
  onClickBubble?: () => void;
  isEditing?: boolean;
  editDraft?: string;
  onEditDraftChange?: (value: string) => void;
  onCancelEdit?: () => void;
  onSubmitEdit?: () => void;
  userProfile: UserProfile;
  assistantProfile?: ConversationIdentity;
  showInlineActions: boolean;
  onFork: () => void;
  onRegenerate: () => void;
  onRetryRun?: () => void;
  onContinueRun?: () => void;
  failureSuperseded?: boolean;
  onFailureDismissed?: () => void;
  onDelete: () => void;
  onViewWorkflow: () => void;
}

export function MessageRow({
  message,
  run,
  uploadUrl,
  onClickBubble,
  isEditing = false,
  editDraft = "",
  onEditDraftChange,
  onCancelEdit,
  onSubmitEdit,
  userProfile,
  assistantProfile = DEFAULT_ASSISTANT_PROFILE,
  showInlineActions,
  onFork,
  onRegenerate,
  onRetryRun,
  onContinueRun,
  failureSuperseded,
  onFailureDismissed,
  onDelete,
  onViewWorkflow,
}: MessageRowProps): JSX.Element {
  if (message.role === "user") {
    return (
      <UserMessageRow
        message={message}
        run={run}
        uploadUrl={uploadUrl}
        userProfile={userProfile}
        showInlineActions={showInlineActions}
        onClickBubble={onClickBubble}
        isEditing={isEditing}
        editDraft={editDraft}
        onEditDraftChange={onEditDraftChange}
        onCancelEdit={onCancelEdit}
        onSubmitEdit={onSubmitEdit}
        onFork={onFork}
        onRegenerate={onRegenerate}
        onDelete={onDelete}
        onViewWorkflow={onViewWorkflow}
      />
    );
  }

  if (message.role === "system") {
    const canRetry = run?.status === "failed" || run?.status === "cancelled";
    return (
      <ConversationFrame mode="prose">
        <SystemMessageRow
          message={message}
          recoveryAttempt={run?.recoveryAttempt}
          superseded={failureSuperseded}
          onDismissed={onFailureDismissed}
          onRetry={canRetry && run.recoveryModes?.includes("retry") ? onRetryRun : undefined}
          onContinue={canRetry && run.recoveryModes?.includes("continue") ? onContinueRun : undefined}
        />
      </ConversationFrame>
    );
  }

  const displayContent = readAssistantDisplayContent(message, run);
  const isStreamingPreface =
    message.kind === "AssistantToolPreface" && run?.status === "running" && run.displayMessageId === message.id;

  return (
    <ConversationFrame mode="wide" className="group/msg" data-message-hover-surface>
      <div className="flex min-w-0 items-start gap-4" data-assistant-message>
        <AssistantMessageAvatar profile={assistantProfile} />
        <div className="assistant-turn-content min-w-0 flex-1">
          <MessageMeta title={assistantProfile.name} timestamp={message.createdAt} />
          {message.kind !== "AssistantToolPreface" ? (
            <RunThinkingPresentation
              run={run}
              presentation={run?.status === "running" ? "live-final-answer" : "terminal-only"}
              showSummaryWhenEmpty={
                (run?.status !== "running" && run?.status !== "cancelling") || !displayContent.trim()
              }
            />
          ) : null}
          <AssistantMessageBody message={{ ...message, content: displayContent }} streaming={isStreamingPreface} />
          <div
            className={cn(
              "mt-3 flex min-h-6 min-w-0 items-center gap-3 overflow-hidden opacity-0 pointer-events-none transition-opacity group-hover/msg:opacity-100 group-hover/msg:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto",
              showInlineActions && "opacity-100 pointer-events-auto",
            )}
          >
            <MessageMetrics
              role="assistant"
              usage={run?.usage ?? message.metadata?.run?.usage}
              run={run}
              modelProvider={run?.modelProvider ?? message.metadata?.run?.modelProvider}
            />
            <div className="ml-auto flex min-w-0">
              <MessageActions
                content={displayContent}
                placement="left"
                hasRequestId={!!message.requestId}
                hasWorkflow={!!run}
                allowMutation={message.kind !== "AssistantToolPreface"}
                onFork={onFork}
                onRegenerate={onRegenerate}
                onDelete={onDelete}
                onViewWorkflow={onViewWorkflow}
              />
            </div>
          </div>
        </div>
      </div>
    </ConversationFrame>
  );
}
