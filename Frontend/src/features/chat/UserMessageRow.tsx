import { motion } from "framer-motion";
import type { ChatMessage, RunRecord, UserProfile } from "../../store/sessionStore";
import { cn } from "../../lib/util";
import { motionTimings, readTapScale, useMotionLevel } from "../../shared/motion";
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
