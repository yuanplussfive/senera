import { motion } from "framer-motion";
import type { ChatMessage, RunRecord, UserProfile } from "../../store/sessionStore";
import { cn } from "../../lib/util";
import { motionTimings, readTapScale, useMotionLevel } from "../../shared/motion";
import { FilePreviewIcon } from "../../components/FilePreviewIcon";
import { MessageActions } from "./MessageActions";
import { MessageAvatar, MessageMeta } from "./MessageChrome";

export interface UserMessageRowProps {
  message: ChatMessage;
  run?: RunRecord;
  userProfile: UserProfile;
  showInlineActions: boolean;
  onClickBubble?: () => void;
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
  onRegenerate,
  onDelete,
  onViewWorkflow,
}: UserMessageRowProps): JSX.Element {
  const { reduceMotion, disableMotion } = useMotionLevel();
  const tapScale = readTapScale(disableMotion || reduceMotion ? "reduced" : "full");

  return (
    <div className="group/msg flex items-start justify-end gap-3">
      <div className="flex min-w-0 max-w-[620px] flex-col items-end">
        <MessageMeta
          align="right"
          title={userProfile.name}
          timestamp={message.createdAt}
          order="time-first"
        />
        {message.attachments && message.attachments.length > 0 ? (
          <MessageAttachments attachments={message.attachments} />
        ) : null}
        <motion.button
          type="button"
          onClick={onClickBubble}
          whileTap={tapScale ? { scale: tapScale } : undefined}
          transition={motionTimings.fast}
          className={cn(
            "mt-1 whitespace-pre-wrap rounded-2xl rounded-tr-md bg-ink-900 px-4 py-2.5 text-left text-[14.5px] leading-relaxed text-paper-50 shadow-bubble-user transition",
            message.requestId
              ? "cursor-text hover:bg-ink-800 focus:outline-none focus:ring-2 focus:ring-terra-200/60"
              : "cursor-default",
          )}
          aria-label="编辑这条消息"
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
      </div>
      <MessageAvatar role="user" profile={userProfile} />
    </div>
  );
}

function MessageAttachments({
  attachments,
}: {
  attachments: NonNullable<ChatMessage["attachments"]>;
}): JSX.Element {
  return (
    <div className="mt-1 flex max-w-full flex-col items-end gap-1">
      {attachments.map((attachment) => (
        <div
          key={attachment.uploadUri}
          className="flex max-w-full items-center gap-1.5 rounded-lg border border-ink-200 bg-paper-50 px-2 py-1 text-[11px] text-ink-650 shadow-sm"
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
