import { motion } from "framer-motion";
import type { ChatMessage, RunRecord, UserProfile } from "../../store/sessionStore";
import { cn } from "../../lib/util";
import { ConversationFrame } from "../../shared/ui";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { motionTimings, readTapScale, useMotionLevel } from "../../shared/motion";
import { FilePreviewIcon } from "./FilePreviewIcon";
import { MessageActions } from "./MessageActions";
import { MessageAvatar, MessageMeta } from "./MessageChrome";
import { InlineMessageEditor } from "./InlineMessageEditor";

export interface UserMessageRowProps {
  message: ChatMessage;
  run?: RunRecord;
  userProfile: UserProfile;
  showInlineActions: boolean;
  onClickBubble?: () => void;
  isEditing: boolean;
  editDraft: string;
  onEditDraftChange?: (value: string) => void;
  onCancelEdit?: () => void;
  onSubmitEdit?: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  onViewWorkflow: () => void;
}

export function UserMessageRow({
  message,
  run,
  userProfile,
  showInlineActions,
  onClickBubble,
  isEditing,
  editDraft,
  onEditDraftChange,
  onCancelEdit,
  onSubmitEdit,
  onRegenerate,
  onDelete,
  onViewWorkflow,
}: UserMessageRowProps): JSX.Element {
  const { reduceMotion, disableMotion } = useMotionLevel();
  const tapScale = readTapScale(disableMotion || reduceMotion ? "reduced" : "full");
  return (
    <ConversationFrame mode="user" className="group/msg items-start justify-end gap-2.5">
      <div className="flex min-w-0 max-w-full flex-col items-end">
        <MessageMeta align="right" timestamp={message.createdAt} />
        {message.attachments && message.attachments.length > 0 ? (
          <MessageAttachments attachments={message.attachments} />
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
            <motion.button
              type="button"
              onClick={onClickBubble}
              whileTap={tapScale ? { scale: tapScale } : undefined}
              transition={motionTimings.fast}
              className={cn(
                "mt-1 whitespace-pre-wrap rounded-lg rounded-tr-sm bg-[var(--theme-chat-user-bg)] px-4 py-2.5 text-left text-[length:var(--theme-chat-user-font-size)] leading-[var(--theme-chat-user-line-height)] text-[var(--theme-chat-user-fg)] transition",
                message.requestId
                  ? "cursor-pointer hover:bg-[var(--theme-chat-user-hover-bg)] focus:outline-none focus:ring-2 focus:ring-accent-focus"
                  : "cursor-default",
              )}
              aria-label={frontendMessage("chat.editMessage")}
            >
              {message.content}
            </motion.button>
            <MessageActions
              content={message.content}
              placement="right"
              hasRequestId={!!message.requestId}
              hasWorkflow={!!run}
              showInlineActions={showInlineActions}
              onRegenerate={onRegenerate}
              onDelete={onDelete}
              onViewWorkflow={onViewWorkflow}
            />
          </>
        )}
      </div>
      <MessageAvatar role="user" profile={userProfile} />
    </ConversationFrame>
  );
}

function MessageAttachments({ attachments }: { attachments: NonNullable<ChatMessage["attachments"]> }): JSX.Element {
  return (
    <div className="mt-1 flex max-w-full flex-col items-end gap-1">
      {attachments.map((attachment) => (
        <div
          key={attachment.uploadUri}
          className="flex max-w-full items-center gap-1.5 rounded-md border border-ink-200 bg-paper-50 px-2 py-1 text-[11px] text-ink-650"
          title={attachment.uploadUri}
        >
          <FilePreviewIcon name={attachment.name} mime={attachment.mime} />
          <span className="min-w-0 truncate">{attachment.name}</span>
          <span className="shrink-0 font-mono text-[10px] text-ink-350">
            {attachment.mime} · {formatFileSize(attachment.size)}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)}KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)}MB`;
}
