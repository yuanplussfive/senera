import type { ChatMessage, RunRecord, UserProfile } from "../../store/sessionStore";
import { ConversationFrame } from "../../shared/ui";
import { AssistantMessageAvatar, MessageMeta } from "./MessageChrome";
import { MessageActions } from "./MessageActions";
import { readAssistantDisplayContent } from "./messagePresentation";
import { AssistantMessageBody } from "./AssistantMessageBody";
import { SystemMessageRow } from "./SystemMessageRow";
import { ThinkingSummaryBar } from "./ThinkingSummaryBar";
import { UserMessageRow } from "./UserMessageRow";

interface MessageRowProps {
  message: ChatMessage;
  run?: RunRecord;
  onClickBubble?: () => void;
  isEditing?: boolean;
  editDraft?: string;
  onEditDraftChange?: (value: string) => void;
  onCancelEdit?: () => void;
  onSubmitEdit?: () => void;
  userProfile: UserProfile;
  showInlineActions: boolean;
  onFork: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  onViewWorkflow: () => void;
}

export function MessageRow({
  message,
  run,
  onClickBubble,
  isEditing = false,
  editDraft = "",
  onEditDraftChange,
  onCancelEdit,
  onSubmitEdit,
  userProfile,
  showInlineActions,
  onFork,
  onRegenerate,
  onDelete,
  onViewWorkflow,
}: MessageRowProps): JSX.Element {
  if (message.role === "user") {
    return (
      <UserMessageRow
        message={message}
        run={run}
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
    return (
      <ConversationFrame mode="prose">
        <SystemMessageRow message={message} />
      </ConversationFrame>
    );
  }

  const displayContent = readAssistantDisplayContent(message, run);

  return (
    <ConversationFrame mode="wide" className="group/msg">
      <div className="flex min-w-0 items-start gap-3" data-assistant-message>
        <AssistantMessageAvatar />
        <div className="min-w-0 flex-1">
          <MessageMeta title="Senera" timestamp={message.createdAt} />
          {message.kind !== "AssistantToolPreface" ? (
            <ThinkingSummaryBar run={run} onViewWorkflow={onViewWorkflow} />
          ) : null}
          <AssistantMessageBody message={{ ...message, content: displayContent }} />
          <MessageActions
            content={displayContent}
            placement="left"
            hasRequestId={!!message.requestId}
            hasWorkflow={!!run}
            allowMutation={message.kind !== "AssistantToolPreface"}
            showInlineActions={showInlineActions}
            onFork={onFork}
            onRegenerate={onRegenerate}
            onDelete={onDelete}
            onViewWorkflow={onViewWorkflow}
          />
        </div>
      </div>
    </ConversationFrame>
  );
}
