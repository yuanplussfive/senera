import type { ModelProviderListItem } from "../../api/eventTypes";
import type { ChatMessage, RunRecord, UserProfile } from "../../store/sessionStore";
import { MessageAvatar, MessageMeta } from "./MessageChrome";
import { MessageActions } from "./MessageActions";
import { readAssistantDisplayContent, readAssistantDisplayName } from "./messagePresentation";
import { AssistantMessageBody } from "./AssistantMessageBody";
import { SystemMessageRow } from "./SystemMessageRow";
import { UserMessageRow } from "./UserMessageRow";

interface MessageRowProps {
  message: ChatMessage;
  run?: RunRecord;
  onClickBubble?: () => void;
  assistantAvatarIcon?: string;
  selectedModelProvider?: ModelProviderListItem;
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
  assistantAvatarIcon,
  selectedModelProvider,
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
        onFork={onFork}
        onRegenerate={onRegenerate}
        onDelete={onDelete}
        onViewWorkflow={onViewWorkflow}
      />
    );
  }

  if (message.role === "system") {
    return <SystemMessageRow message={message} />;
  }

  const displayContent = readAssistantDisplayContent(message, run);

  return (
    <div className="group/msg flex items-start gap-3">
      <MessageAvatar role="assistant" icon={assistantAvatarIcon} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MessageMeta title={readAssistantDisplayName(message, selectedModelProvider)} timestamp={message.createdAt} />
        <AssistantMessageBody
          message={{ ...message, content: displayContent }}
          run={run}
          onViewWorkflow={onViewWorkflow}
        />
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
  );
}
