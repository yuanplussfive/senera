import type { KeyboardEvent, MouseEvent } from "react";
import type { ChatMessage, RunRecord, UserProfile } from "../../store/sessionStore";
import { cn } from "../../lib/util";
import { ConversationFrame } from "../../shared/ui";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { MessageActions } from "./MessageActions";
import { MessageAttachments } from "./MessageAttachments";
import { MessageAvatar, MessageTime } from "./MessageChrome";
import { InlineMessageEditor } from "./InlineMessageEditor";
import { MessageMetrics } from "./MessageMetrics";
import { ChatMessageMarkdown } from "./ChatMessageMarkdown";

export interface UserMessageRowProps {
  message: ChatMessage;
  run?: RunRecord;
  uploadUrl: string;
  userProfile: UserProfile;
  showInlineActions: boolean;
  onClickBubble?: () => void;
  isEditing: boolean;
  editDraft: string;
  onEditDraftChange?: (value: string) => void;
  onCancelEdit?: () => void;
  onSubmitEdit?: () => void;
  onFork: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  onViewWorkflow: () => void;
}

export function UserMessageRow({
  message,
  run,
  uploadUrl,
  userProfile,
  showInlineActions,
  onClickBubble,
  isEditing,
  editDraft,
  onEditDraftChange,
  onCancelEdit,
  onSubmitEdit,
  onFork,
  onRegenerate,
  onDelete,
  onViewWorkflow,
}: UserMessageRowProps): JSX.Element {
  const canEdit = Boolean(message.requestId && onClickBubble);

  const handleBubbleClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (!canEdit || (event.target instanceof Element && event.target.closest("a, button"))) return;
    onClickBubble?.();
  };

  const handleBubbleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!canEdit || event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onClickBubble?.();
  };

  return (
    <ConversationFrame mode="user" className="group/msg items-start justify-end gap-3">
      <div className="flex min-w-0 max-w-full flex-col items-end">
        {message.attachments && message.attachments.length > 0 ? (
          <MessageAttachments attachments={message.attachments} uploadUrl={uploadUrl} />
        ) : null}
        {isEditing ? (
          <InlineMessageEditor
            draft={editDraft}
            onDraftChange={(value) => onEditDraftChange?.(value)}
            onCancel={() => onCancelEdit?.()}
            onSubmit={() => onSubmitEdit?.()}
          />
        ) : (
          <>
            <div
              onClick={handleBubbleClick}
              onKeyDown={handleBubbleKeyDown}
              role={canEdit ? "button" : undefined}
              tabIndex={canEdit ? 0 : undefined}
              className={cn(
                "max-w-full min-w-0 overflow-hidden rounded-2xl rounded-tr-[6px] bg-[var(--theme-chat-user-bg)] px-4 py-3 text-left text-[length:var(--theme-chat-user-font-size-scaled)] leading-[var(--theme-chat-user-line-height)] text-[var(--theme-chat-user-fg)] shadow-[var(--shadow-bubble-user)] transition",
                canEdit
                  ? "cursor-pointer hover:bg-[var(--theme-chat-user-hover-bg)] focus:outline-none focus:ring-2 focus:ring-accent-focus"
                  : "cursor-default",
              )}
              aria-label={canEdit ? frontendMessage("chat.editMessage") : undefined}
              data-user-message-bubble
            >
              <ChatMessageMarkdown
                content={message.content}
                className="min-w-0 max-w-full"
                contentClassName={cn(
                  "text-[length:var(--theme-chat-user-font-size-scaled)] leading-[var(--theme-chat-user-line-height)] text-[var(--theme-chat-user-fg)]",
                  canEdit && "cursor-pointer",
                )}
                externalLinkPresentation="text"
              />
            </div>
            <div
              className={cn(
                "mt-3 flex min-h-6 min-w-0 items-center justify-end gap-3 overflow-hidden opacity-0 pointer-events-none transition-opacity group-hover/msg:opacity-100 group-hover/msg:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto",
                showInlineActions && "opacity-100 pointer-events-auto",
              )}
            >
              <MessageMetrics role="user" text={message.content} />
              <MessageTime timestamp={message.createdAt} />
              <MessageActions
                content={message.content}
                placement="right"
                hasRequestId={!!message.requestId}
                hasWorkflow={!!run}
                onFork={onFork}
                onRegenerate={onRegenerate}
                onDelete={onDelete}
                onViewWorkflow={onViewWorkflow}
              />
            </div>
          </>
        )}
      </div>
      <MessageAvatar role="user" profile={userProfile} />
    </ConversationFrame>
  );
}
