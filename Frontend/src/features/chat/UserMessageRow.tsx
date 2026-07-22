import { motion } from "framer-motion";
import type { ChatMessage, RunRecord, UserProfile } from "../../store/sessionStore";
import { cn } from "../../lib/util";
import { ConversationFrame } from "../../shared/ui";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { motionTimings, readTapScale, useMotionLevel } from "../../shared/motion";
import { MessageActions } from "./MessageActions";
import { MessageAttachments } from "./MessageAttachments";
import { MessageAvatar, MessageMeta } from "./MessageChrome";
import { InlineMessageEditor } from "./InlineMessageEditor";

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
  const { reduceMotion, disableMotion } = useMotionLevel();
  const tapScale = readTapScale(disableMotion || reduceMotion ? "reduced" : "full");
  return (
    <ConversationFrame mode="user" className="group/msg items-start justify-end gap-2.5">
      <div className="flex min-w-0 max-w-full flex-col items-end">
        <MessageMeta align="right" timestamp={message.createdAt} />
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
            <motion.button
              type="button"
              onClick={onClickBubble}
              whileTap={tapScale ? { scale: tapScale } : undefined}
              transition={motionTimings.fast}
              className={cn(
                "mt-1 whitespace-pre-wrap rounded-2xl rounded-tr-[5px] bg-[var(--theme-chat-user-bg)] px-4 py-2.5 text-left text-[length:var(--theme-chat-user-font-size)] leading-[var(--theme-chat-user-line-height)] text-[var(--theme-chat-user-fg)] shadow-[var(--shadow-bubble-user)] transition",
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
              onFork={onFork}
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
