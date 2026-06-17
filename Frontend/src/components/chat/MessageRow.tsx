import { Check, Copy, GitBranch, RotateCcw, Trash2, User } from "lucide-react";
import { motion } from "framer-motion";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { ModelProviderListItem } from "../../api/eventTypes";
import type { ChatMessage, RunRecord, UserProfile } from "../../store/sessionStore";
import { cn, formatTime } from "../../lib/util";
import { AgentExecutionFeed } from "../AgentExecutionFeed";
import { LazyMarkdownRenderer } from "../LazyMarkdownRenderer";
import { FilePreviewIcon } from "../FilePreviewIcon";
import { ModelProviderIcon } from "../ModelProviderIcon";
import { Tooltip } from "../ui/Tooltip";
import { ThinkingSummaryBar } from "./ThinkingSummaryBar";
import { formatModelProviderName } from "./modelProvider";
import { motionTimings, readTapScale, useMotionLevel } from "../../shared/motion";

interface MessageRowProps {
  message: ChatMessage;
  run?: RunRecord;
  onClickBubble?: () => void;
  assistantAvatarIcon?: string;
  selectedModelProvider?: ModelProviderListItem;
  userProfile: UserProfile;
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
  onRegenerate,
  onDelete,
  onViewWorkflow,
}: MessageRowProps): JSX.Element {
  const { reduceMotion, disableMotion } = useMotionLevel();
  const tapScale = readTapScale(disableMotion || reduceMotion ? "reduced" : "full");

  if (message.role === "user") {
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
            onRegenerate={onRegenerate}
            onDelete={onDelete}
            onViewWorkflow={onViewWorkflow}
          />
        </div>
        <Avatar role="user" profile={userProfile} />
      </div>
    );
  }

  if (message.role === "system") {
    return (
      <div className="mx-auto max-w-md rounded-md border border-brick-100 bg-brick-50/60 px-3 py-1.5 text-center text-[12px] text-brick-600">
        {message.content}
      </div>
    );
  }

  return (
    <div className="group/msg flex items-start gap-3">
      <Avatar role="assistant" icon={assistantAvatarIcon} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MessageMeta
          title={readAssistantDisplayName(message, selectedModelProvider)}
          timestamp={message.createdAt}
        />
        <div className="mt-1 min-w-0">
          <ThinkingSummaryBar run={run} onViewWorkflow={onViewWorkflow} />
          <LazyMarkdownRenderer
            className="mt-1 min-w-0"
            contentClassName="text-[14.5px] leading-[1.85] text-ink-800"
          >
            {message.content}
          </LazyMarkdownRenderer>
          {message.kind === "AskUser" ? (
            <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-terra-50 px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider text-terra-600">
              需要你的回复
            </div>
          ) : null}
        </div>
        <MessageActions
          content={message.content}
          placement="left"
          hasRequestId={!!message.requestId}
          hasWorkflow={!!run}
          onRegenerate={onRegenerate}
          onDelete={onDelete}
          onViewWorkflow={onViewWorkflow}
        />
      </div>
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
          <FilePreviewIcon
            name={attachment.name}
            mime={attachment.mime}
          />
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

export function StreamingRow({
  run,
  assistantAvatarIcon,
  selectedModelProvider,
}: {
  run: RunRecord;
  assistantAvatarIcon?: string;
  selectedModelProvider?: ModelProviderListItem;
}): JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <Avatar role="assistant" icon={assistantAvatarIcon} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MessageMeta
          title={readRunDisplayName(run, selectedModelProvider)}
          timestamp={run.startedAt}
        />
        <div className="mt-1">
          <AgentExecutionFeed run={run} />
        </div>
      </div>
    </div>
  );
}

function MessageActions({
  content,
  placement,
  hasRequestId,
  hasWorkflow,
  onRegenerate,
  onDelete,
  onViewWorkflow,
}: {
  content: string;
  placement: "left" | "right";
  hasRequestId: boolean;
  hasWorkflow: boolean;
  onRegenerate: () => void;
  onDelete: () => void;
  onViewWorkflow: () => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success("已复制");
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("复制失败");
    }
  };
  return (
    <div
      className={cn(
        "mt-1.5 flex items-center gap-0.5 opacity-0 transition group-hover/msg:opacity-100 focus-within:opacity-100",
        placement === "right" ? "justify-end" : "justify-start",
      )}
    >
      <ActionBtn label="复制" onClick={onCopy}>
        {copied ? <Check className="h-3.5 w-3.5 text-moss-500" /> : <Copy className="h-3.5 w-3.5" />}
      </ActionBtn>
      {hasRequestId && hasWorkflow ? (
        <ActionBtn label="查看工作流" onClick={onViewWorkflow}>
          <GitBranch className="h-3.5 w-3.5" />
        </ActionBtn>
      ) : null}
      {hasRequestId ? (
        <ActionBtn label="从此处重新回答" onClick={onRegenerate}>
          <RotateCcw className="h-3.5 w-3.5" />
        </ActionBtn>
      ) : null}
      {hasRequestId ? (
        <ActionBtn label="从此处删除" onClick={onDelete} destructive>
          <Trash2 className="h-3.5 w-3.5" />
        </ActionBtn>
      ) : null}
    </div>
  );
}

function ActionBtn({
  children,
  label,
  onClick,
  destructive = false,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}): JSX.Element {
  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "grid h-7 w-7 place-items-center rounded-md text-ink-400 transition hover:bg-ink-900/[0.05]",
          destructive ? "hover:text-brick-500" : "hover:text-ink-800",
        )}
        aria-label={label}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function MessageMeta({
  title,
  timestamp,
  align = "left",
  order = "title-first",
}: {
  title: string;
  timestamp: string;
  align?: "left" | "right";
  order?: "title-first" | "time-first";
}): JSX.Element {
  const titleNode = (
    <span className="min-w-0 truncate text-[13px] font-semibold text-ink-850">
      {title}
    </span>
  );
  const timeNode = (
    <span className="shrink-0 font-mono text-[10.5px] text-ink-400">
      {formatTime(timestamp)}
    </span>
  );

  return (
    <div
      className={cn(
        "flex min-w-0 items-baseline gap-2",
        align === "right" && "justify-end",
      )}
    >
      {order === "time-first" ? timeNode : titleNode}
      {order === "time-first" ? titleNode : timeNode}
    </div>
  );
}

function readAssistantDisplayName(
  message: ChatMessage,
  selectedModelProvider?: ModelProviderListItem,
): string {
  return formatModelProviderName(message.metadata?.run?.modelProvider ?? selectedModelProvider);
}

function readRunDisplayName(
  run: RunRecord,
  selectedModelProvider?: ModelProviderListItem,
): string {
  return formatModelProviderName(run.modelProvider ?? selectedModelProvider);
}

function Avatar({
  role,
  icon,
  profile,
}: {
  role: "user" | "assistant";
  icon?: string;
  profile?: UserProfile;
}): JSX.Element {
  if (role === "user") {
    const fallback = readUserInitial(profile?.name);
    return (
      <div className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-ink-200 text-[12px] font-semibold text-ink-700 ring-1 ring-ink-200/80">
        {profile?.avatarDataUrl ? (
          <img src={profile.avatarDataUrl} alt={profile.name} className="h-full w-full object-cover" />
        ) : fallback ? (
          fallback
        ) : (
          <User className="h-3.5 w-3.5" />
        )}
      </div>
    );
  }
  const hasIcon = !!icon;
  return (
    <div className="relative grid h-8 w-8 shrink-0 place-items-center">
      <div
        className={cn(
          "relative z-10 grid h-8 w-8 place-items-center rounded-xl text-ink-700",
          hasIcon ? "bg-paper-50 ring-1 ring-ink-200" : "bg-transparent",
        )}
      >
        {hasIcon ? <ModelProviderIcon icon={icon} size={18} /> : null}
      </div>
    </div>
  );
}

function readUserInitial(name?: string): string {
  return name?.trim().slice(0, 1).toUpperCase() ?? "";
}
