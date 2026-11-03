import type { KeyboardEvent, MouseEvent } from "react";
import type { ChannelEventData } from "../../api/eventTypes";
import type { ChatMessage, RunRecord, UserProfile } from "../../store/sessionStore";
import { cn } from "../../lib/util";
import { ConversationFrame } from "../../shared/ui";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { MessageActions } from "./MessageActions";
import { MessageAttachments } from "./MessageAttachments";
import { MessageAvatar, MessageFooter, MessageMeta, MessageTime } from "./MessageChrome";
import { InlineMessageEditor } from "./InlineMessageEditor";
import { MessageMetrics } from "./MessageMetrics";
import { ChatMessageMarkdown } from "./ChatMessageMarkdown";
import { ActivityLoader, AppIcon } from "../../shared/ui";

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
  const channelEvent = message.metadata?.channelEvent;
  if (channelEvent) {
    return (
      <ConversationFrame mode="prose" className="group/msg" data-message-hover-surface>
        <div className="flex min-w-0 flex-col items-center gap-1 py-1" data-channel-event={channelEvent.type}>
          <p className="max-w-full whitespace-pre-wrap break-words text-center text-xs leading-5 text-content-muted">
            {describeChannelEvent(channelEvent)}
          </p>
          <MessageMeta timestamp={channelEvent.sentAt} />
          <MessageFooter visible={showInlineActions}>
            <MessageActions
              content=""
              placement="right"
              hasRequestId={!!message.requestId}
              hasWorkflow={!!run}
              allowCopy={false}
              allowFork={false}
              allowMutation={false}
              onFork={onFork}
              onRegenerate={onRegenerate}
              onDelete={onDelete}
              onViewWorkflow={onViewWorkflow}
            />
          </MessageFooter>
        </div>
      </ConversationFrame>
    );
  }

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
    <ConversationFrame mode="user" className="group/msg items-start justify-end gap-3" data-message-hover-surface>
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
            <QueuedMessageStatus message={message} />
            <MessageFooter visible={showInlineActions} align="right">
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
            </MessageFooter>
          </>
        )}
      </div>
      <MessageAvatar role="user" profile={userProfile} />
    </ConversationFrame>
  );
}

function describeChannelEvent(event: ChannelEventData): string {
  const actor = event.actorName ?? event.actorId;
  const target = event.targetName ?? event.targetId;
  if (event.type === "poke") {
    return frontendMessage(target ? "chat.channelEvent.pokeTarget" : "chat.channelEvent.poke", { actor, target });
  }
  if (event.type === "recall") return frontendMessage("chat.channelEvent.recall", { actor });
  return frontendMessage(target ? "chat.channelEvent.target" : "chat.channelEvent.action", {
    actor,
    target,
    type: event.type,
  });
}

const queuedMessageStatusKeys = {
  pending: {
    steer: "chat.queue.pending.steer",
    follow_up: "chat.queue.pending.follow_up",
  },
  accepted: {
    steer: "chat.queue.accepted.steer",
    follow_up: "chat.queue.accepted.follow_up",
  },
  delivered: { steer: "chat.queue.delivered", follow_up: "chat.queue.delivered" },
  failed: { steer: "chat.queue.failed", follow_up: "chat.queue.failed" },
  cancelled: { steer: "chat.queue.cancelled", follow_up: "chat.queue.cancelled" },
} as const;

function QueuedMessageStatus({ message }: { message: ChatMessage }): JSX.Element | null {
  const queued = message.metadata?.queue;
  const admission = message.queueAdmission;
  const mode = queued?.mode ?? admission?.mode;
  if (!mode) return null;
  if (queued?.status === "completed") return null;

  if (admission?.status === "rejected") {
    return (
      <div
        className="mt-1 flex max-w-full items-center justify-end gap-1.5 px-1 text-[10.5px] leading-4 text-brick-600"
        role="status"
      >
        <AppIcon icon="alert-circle" size={12} aria-hidden />
        <span className="min-w-0 break-words text-right">
          {frontendMessage("chat.queue.rejected", { message: admission.message ?? "" })}
        </span>
      </div>
    );
  }

  const status =
    admission?.status === "pending"
      ? "pending"
      : queued?.status && queued.status !== "pending"
        ? queued.status
        : "accepted";
  return (
    <div
      className="mt-1 flex items-center justify-end gap-1.5 px-1 text-[10.5px] leading-4 text-content-muted"
      role="status"
      aria-live="polite"
      data-queued-message-status={status}
    >
      {status === "pending" ? (
        <ActivityLoader size={12} active />
      ) : (
        <AppIcon
          icon={status === "failed" || status === "cancelled" ? "alert-circle" : "checkmark"}
          size={12}
          aria-hidden
        />
      )}
      <span className="min-w-0 break-words text-right">
        {frontendMessage(queuedMessageStatusKeys[status][mode])}
        {status === "failed" && queued?.message ? ` · ${queued.message}` : ""}
      </span>
    </div>
  );
}
