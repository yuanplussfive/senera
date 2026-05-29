import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  ArrowUp,
  Paperclip,
  User,
  Loader2,
  Square,
  Copy,
  RotateCcw,
  Trash2,
  Check,
  GitBranch,
  CornerDownLeft,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useStore, type ChatMessage, type RunRecord, type UserProfile, DEFAULT_SESSION_TITLE } from "../store/sessionStore";
import { cn, formatTime } from "../lib/util";
import { AgentExecutionFeed } from "./AgentExecutionFeed";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { Tooltip } from "./ui/Tooltip";
import { Dialog, DialogContent } from "./ui/Dialog";
import { ScrollArea } from "./ui/ScrollArea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/DropdownMenu";
import type { ModelProviderListItem, ModelProviderMetadata } from "../api/eventTypes";
import { ModelProviderIcon } from "./ModelProviderIcon";
import { LogoMark } from "./ui/Logo";

interface Props {
  modelProviders: ModelProviderListItem[];
  selectedModelProviderId: string | null;
  onSelectModelProvider: (id: string) => void;
  socketStatus: string;
  onSend: (input: string) => void;
  onCancel: () => void;
  onRegenerate: (message: ChatMessage) => void;
  onEditUserMessage: (message: ChatMessage, nextContent: string) => void;
  onDeleteFromMessage: (message: ChatMessage) => void;
  onViewWorkflow: (message: ChatMessage) => void;
  userProfile: UserProfile;
}

export function ChatPanel({
  modelProviders,
  selectedModelProviderId,
  onSelectModelProvider,
  socketStatus,
  onSend,
  onCancel,
  onRegenerate,
  onEditUserMessage,
  onDeleteFromMessage,
  onViewWorkflow,
  userProfile,
}: Props): JSX.Element {
  const activeId = useStore((s) => s.activeSessionId);
  const session = useStore((s) => (activeId ? s.sessions[activeId] : null));

  const messages = session?.messages ?? [];
  const currentRun = session?.runs[session.runs.length - 1];
  const isRunning = currentRun?.status === "running";
  const assistantAvatarIcon = useMemo(
    () => readSelectedModelProvider(modelProviders, selectedModelProviderId)?.icon,
    [modelProviders, selectedModelProviderId],
  );
  const selectedModelProvider = useMemo(
    () => readSelectedModelProvider(modelProviders, selectedModelProviderId),
    [modelProviders, selectedModelProviderId],
  );

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-paper-50">
      <ChatHeader title={session?.title ?? DEFAULT_SESSION_TITLE} runStatus={currentRun?.status} />
      {messages.length === 0 && !isRunning ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <EmptyState />
        </div>
      ) : (
        <MessageList
          sessionId={session?.sessionId ?? activeId ?? ""}
          messages={messages}
          currentRun={isRunning ? currentRun : undefined}
          assistantAvatarIcon={assistantAvatarIcon}
          selectedModelProvider={selectedModelProvider}
          userProfile={userProfile}
          onRegenerate={onRegenerate}
          onEditUserMessage={onEditUserMessage}
          onDeleteFromMessage={onDeleteFromMessage}
          onViewWorkflow={onViewWorkflow}
        />
      )}
      <InputBar
        disabled={socketStatus !== "open"}
        running={!!isRunning}
        modelProviders={modelProviders}
        selectedModelProviderId={selectedModelProviderId}
        onSelectModelProvider={onSelectModelProvider}
        socketStatus={socketStatus}
        onSend={onSend}
        onCancel={onCancel}
      />
    </main>
  );
}

// ---------- 头部 ----------

function ChatHeader({
  title,
  runStatus,
}: {
  title: string;
  runStatus?: "running" | "completed" | "failed" | "cancelled";
}): JSX.Element {
  return (
    <div className="flex h-14 items-center gap-2 border-b border-ink-200/60 px-6">
      <h1 className="font-serif text-[17px] italic text-ink-900" style={{ fontWeight: 500 }}>
        {title}
      </h1>
      {runStatus === "running" ? (
        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-terra-50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-terra-600">
          <Loader2 className="h-2.5 w-2.5 animate-spin" /> live
        </span>
      ) : runStatus === "failed" ? (
        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-brick-50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-brick-600">
          failed
        </span>
      ) : runStatus === "cancelled" ? (
        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-500">
          cancelled
        </span>
      ) : null}
    </div>
  );
}

// ---------- 虚拟化消息列表 ----------

interface MessageListProps {
  sessionId: string;
  messages: ChatMessage[];
  currentRun?: RunRecord;
  assistantAvatarIcon?: string;
  selectedModelProvider?: ModelProviderListItem;
  userProfile: UserProfile;
  onRegenerate: (m: ChatMessage) => void;
  onEditUserMessage: (m: ChatMessage, nextContent: string) => void;
  onDeleteFromMessage: (m: ChatMessage) => void;
  onViewWorkflow: (m: ChatMessage) => void;
}

const MESSAGE_LIST_BOTTOM_THRESHOLD = 120;
const SCROLL_AWAY_KEYS = new Set<KeyboardEvent["key"]>(["ArrowUp", "PageUp", "Home"]);

type MessageListItem = ChatMessage | { __streaming: true; run: RunRecord };

function useVirtuosoAutoStickToBottom({
  itemCount,
  resetKey,
  activityKey,
  bottomThreshold,
}: {
  itemCount: number;
  resetKey: string;
  activityKey: string;
  bottomThreshold: number;
}): {
  ref: RefObject<VirtuosoHandle>;
  scrollerRef: (ref: HTMLElement | Window | null) => void;
  followOutput: (isAtBottom: boolean) => "auto" | false;
  atBottomStateChange: (atBottom: boolean) => void;
  totalListHeightChanged: (height: number) => void;
} {
  const ref = useRef<VirtuosoHandle>(null);
  const stickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const lastListHeightRef = useRef(0);
  const lastTouchYRef = useRef<number | null>(null);
  const userScrollAwayIntentRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const [scroller, setScroller] = useState<HTMLElement | Window | null>(null);

  const cancelPendingScroll = useCallback(() => {
    if (frameRef.current === null) return;
    window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  const scrollToBottom = useCallback(() => {
    if (itemCount <= 0) return;
    cancelPendingScroll();
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      ref.current?.scrollToIndex({
        index: itemCount - 1,
        align: "end",
        behavior: "auto",
      });
    });
  }, [cancelPendingScroll, itemCount]);

  const rememberScrollPosition = useCallback((target: HTMLElement | Window): void => {
    lastScrollTopRef.current = readScrollMetrics(target).scrollTop;
  }, []);

  const scrollerRef = useCallback(
    (target: HTMLElement | Window | null): void => {
      setScroller(target);
      if (target) rememberScrollPosition(target);
    },
    [rememberScrollPosition],
  );

  const handleScrollerScroll = useCallback(() => {
    if (!scroller) return;
    const metrics = readScrollMetrics(scroller);
    lastScrollTopRef.current = metrics.scrollTop;

    if (metrics.distanceToBottom <= bottomThreshold) {
      stickToBottomRef.current = true;
      userScrollAwayIntentRef.current = false;
      return;
    }

    if (userScrollAwayIntentRef.current) {
      stickToBottomRef.current = false;
      cancelPendingScroll();
    }
  }, [bottomThreshold, cancelPendingScroll, scroller]);

  useEffect(() => {
    if (!scroller) return;
    const target = scroller;
    const markScrollAwayIntent = (): void => {
      userScrollAwayIntentRef.current = true;
    };
    const handleWheel: EventListener = (event): void => {
      if (event instanceof WheelEvent && event.deltaY < 0) markScrollAwayIntent();
    };
    const handleTouchStart: EventListener = (event): void => {
      if (!(event instanceof TouchEvent)) return;
      lastTouchYRef.current = event.touches.item(0)?.clientY ?? null;
    };
    const handleTouchMove: EventListener = (event): void => {
      if (!(event instanceof TouchEvent)) return;
      const currentY = event.touches.item(0)?.clientY;
      const lastY = lastTouchYRef.current;
      lastTouchYRef.current = currentY ?? null;
      if (currentY != null && lastY != null && currentY > lastY) markScrollAwayIntent();
    };
    const handleKeyDown: EventListener = (event): void => {
      if (event instanceof KeyboardEvent && isScrollAwayKey(event)) markScrollAwayIntent();
    };

    scroller.addEventListener("scroll", handleScrollerScroll, { passive: true });
    target.addEventListener("wheel", handleWheel, { passive: true });
    target.addEventListener("touchstart", handleTouchStart, { passive: true });
    target.addEventListener("touchmove", handleTouchMove, { passive: true });
    target.addEventListener("keydown", handleKeyDown);

    return () => {
      scroller.removeEventListener("scroll", handleScrollerScroll);
      target.removeEventListener("wheel", handleWheel);
      target.removeEventListener("touchstart", handleTouchStart);
      target.removeEventListener("touchmove", handleTouchMove);
      target.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleScrollerScroll, scroller]);

  useEffect(() => {
    stickToBottomRef.current = true;
    userScrollAwayIntentRef.current = false;
    scrollToBottom();
  }, [resetKey, scrollToBottom]);

  useEffect(() => {
    if (stickToBottomRef.current) scrollToBottom();
  }, [activityKey, scrollToBottom]);

  useEffect(() => cancelPendingScroll, [cancelPendingScroll]);

  return {
    ref,
    scrollerRef,
    followOutput: (isAtBottom) => (isAtBottom || stickToBottomRef.current ? "auto" : false),
    atBottomStateChange: (atBottom) => {
      if (atBottom) stickToBottomRef.current = true;
    },
    totalListHeightChanged: (height) => {
      if (height === lastListHeightRef.current) return;
      lastListHeightRef.current = height;
      if (stickToBottomRef.current) scrollToBottom();
    },
  };
}

function readScrollMetrics(target: HTMLElement | Window): {
  scrollTop: number;
  scrollHeight: number;
  viewportHeight: number;
  distanceToBottom: number;
} {
  const element =
    target instanceof Window
      ? target.document.scrollingElement ?? target.document.documentElement
      : target;
  const scrollTop = target instanceof Window ? target.scrollY || element.scrollTop : element.scrollTop;
  const viewportHeight = target instanceof Window ? target.innerHeight : element.clientHeight;
  const distanceToBottom = Math.max(0, element.scrollHeight - scrollTop - viewportHeight);

  return {
    scrollTop,
    scrollHeight: element.scrollHeight,
    viewportHeight,
    distanceToBottom,
  };
}

function isScrollAwayKey(event: KeyboardEvent): boolean {
  return SCROLL_AWAY_KEYS.has(event.key) || (event.shiftKey && event.key === " ");
}

function isStreamingListItem(item: MessageListItem): item is Extract<MessageListItem, { __streaming: true }> {
  return "__streaming" in item;
}

function readMessageListItemKey(item: MessageListItem): string {
  return isStreamingListItem(item) ? "__streaming__" : item.id;
}

function MessageList({
  sessionId,
  messages,
  currentRun,
  assistantAvatarIcon,
  selectedModelProvider,
  userProfile,
  onRegenerate,
  onEditUserMessage,
  onDeleteFromMessage,
  onViewWorkflow,
}: MessageListProps): JSX.Element {
  const [editing, setEditing] = useState<{ id: string; message: ChatMessage } | null>(null);
  const [draft, setDraft] = useState("");
  const items = useMemo(
    () => (currentRun ? [...messages, { __streaming: true as const, run: currentRun }] : messages),
    [messages, currentRun],
  );
  const lastItemKey = items.length > 0 ? readMessageListItemKey(items[items.length - 1]) : "";
  const autoScroll = useVirtuosoAutoStickToBottom({
    itemCount: items.length,
    resetKey: `${sessionId}:${currentRun?.requestId ?? ""}`,
    activityKey: `${lastItemKey}:${currentRun?.revision ?? 0}`,
    bottomThreshold: MESSAGE_LIST_BOTTOM_THRESHOLD,
  });

  return (
    <>
      <Virtuoso
        ref={autoScroll.ref}
        scrollerRef={autoScroll.scrollerRef}
        style={{ flex: 1, minHeight: 0 }}
        data={items}
        followOutput={autoScroll.followOutput}
        atBottomStateChange={autoScroll.atBottomStateChange}
        totalListHeightChanged={autoScroll.totalListHeightChanged}
        initialTopMostItemIndex={items.length > 0 ? items.length - 1 : 0}
        atBottomThreshold={MESSAGE_LIST_BOTTOM_THRESHOLD}
        overscan={{ main: 900, reverse: 900 }}
        computeItemKey={(_, item) => readMessageListItemKey(item)}
        itemContent={(_, item) => {
          if ("__streaming" in item) {
            return (
              <div className="chat-message-item mx-auto box-border w-full max-w-3xl px-6 pb-3 pt-1">
                <StreamingRow
                  run={item.run}
                  assistantAvatarIcon={assistantAvatarIcon}
                  selectedModelProvider={selectedModelProvider}
                />
              </div>
            );
          }
          return (
            <div className="chat-message-item mx-auto box-border w-full max-w-3xl px-6 pb-3 pt-1">
              <MessageRow
                message={item}
                onClickBubble={() => {
                  if (item.role !== "user") return;
                  if (!item.requestId) return;
                  setEditing({ id: item.id, message: item });
                  setDraft(item.content ?? "");
                }}
                assistantAvatarIcon={assistantAvatarIcon}
                selectedModelProvider={selectedModelProvider}
                userProfile={userProfile}
                onRegenerate={() => onRegenerate(item)}
                onDelete={() => onDeleteFromMessage(item)}
                onViewWorkflow={() => onViewWorkflow(item)}
              />
            </div>
          );
        }}
        components={{
          Header: () => <div className="h-6" />,
          Footer: () => <div className="h-8" />,
        }}
      />
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (open) return;
          setEditing(null);
          setDraft("");
        }}
      >
        <DialogContent title="编辑用户消息" description="保存后会从这条消息开始重新生成后续回复。">
          <div className="flex max-h-[calc(100vh-140px)] flex-col bg-paper-50">
            <div className="flex items-center justify-between gap-3 px-4 py-3 text-[12px] text-ink-500">
              <span className="min-w-0 truncate">
                {editing?.message.createdAt ? `原消息 · ${formatTime(editing.message.createdAt)}` : "原消息"}
              </span>
              <span className="hidden flex-shrink-0 items-center gap-1.5 sm:inline-flex">
                <CornerDownLeft className="h-3.5 w-3.5" />
                Ctrl/⌘ + Enter
              </span>
            </div>

            <ScrollArea className="flex-1" viewportClassName="px-4 pb-4">
              <div className="overflow-hidden rounded-lg border border-ink-200/80 bg-paper-100/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setEditing(null);
                      setDraft("");
                      return;
                    }
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                      e.preventDefault();
                      const target = editing?.message;
                      if (!target) return;
                      const next = draft.trim();
                      if (!next) {
                        toast.error("内容不能为空");
                        return;
                      }
                      onEditUserMessage(target, next);
                      setEditing(null);
                      setDraft("");
                    }
                  }}
                  rows={14}
                  className={cn(
                    "block min-h-[260px] w-full resize-none border-0 bg-transparent px-3.5 py-3",
                    "text-[13.5px] leading-relaxed text-ink-900 outline-none placeholder:text-ink-300",
                    "focus:ring-0",
                  )}
                  placeholder="输入修改后的用户消息..."
                  autoFocus
                />
                <div className="flex items-center justify-between border-t border-ink-200/70 px-3.5 py-2 text-[11.5px] text-ink-500">
                  <span>Esc 取消</span>
                  <span>{draft.trim().length} 字符</span>
                </div>
              </div>
            </ScrollArea>

            <div className="flex flex-col gap-2 border-t border-ink-200/70 bg-paper-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-[12px] leading-relaxed text-ink-500">
                当前消息之后的回复会被替换。
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-8 items-center rounded-md border border-ink-200/80 bg-paper-50 px-3",
                    "text-[12.5px] text-ink-700 transition hover:bg-ink-900/[0.04]",
                    "focus:outline-none focus:ring-2 focus:ring-terra-200/60",
                  )}
                  onClick={() => {
                    setEditing(null);
                    setDraft("");
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-8 items-center rounded-md bg-ink-900 px-3.5",
                    "text-[12.5px] font-medium text-paper-50 transition hover:bg-ink-900/90",
                    "disabled:cursor-not-allowed disabled:opacity-45",
                    "focus:outline-none focus:ring-2 focus:ring-terra-200/60",
                  )}
                  disabled={!draft.trim()}
                  onClick={() => {
                    const target = editing?.message;
                    if (!target) return;
                    const next = draft.trim();
                    if (!next) {
                      toast.error("内容不能为空");
                      return;
                    }
                    onEditUserMessage(target, next);
                    setEditing(null);
                    setDraft("");
                  }}
                >
                  保存并重新回答
                </button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------- 消息行 ----------

function EmptyState(): JSX.Element {
  const suggestions = (import.meta.env.VITE_EMPTY_SUGGESTIONS ?? "")
    .split("|")
    .map((s: string) => s.trim())
    .filter(Boolean);
  return (
    <div className="flex max-w-xl flex-col items-center text-center">
      <LogoMark size={34} />
      <h2 className="mt-5 font-serif text-[26px] italic text-ink-900" style={{ fontWeight: 500 }}>
        今天想做点什么？
      </h2>
      <p className="mt-1 text-[13.5px] text-ink-500">
        senera 用行动决策协议处理你的请求；右栏会展示完整的思考、决策与工具链路。
      </p>
      {suggestions.length > 0 ? (
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
          {suggestions.map((s: string) => (
            <span
              key={s}
              className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-paper-100 px-3 py-1 text-[12.5px] text-ink-700"
            >
              {s}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface MessageRowProps {
  message: ChatMessage;
  onClickBubble?: () => void;
  assistantAvatarIcon?: string;
  selectedModelProvider?: ModelProviderListItem;
  userProfile: UserProfile;
  onRegenerate: () => void;
  onDelete: () => void;
  onViewWorkflow: () => void;
}

function MessageRow({
  message,
  onClickBubble,
  assistantAvatarIcon,
  selectedModelProvider,
  userProfile,
  onRegenerate,
  onDelete,
  onViewWorkflow,
}: MessageRowProps): JSX.Element {
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
          <button
            type="button"
            onClick={onClickBubble}
            className={cn(
              "mt-1 whitespace-pre-wrap rounded-2xl rounded-tr-md bg-ink-900 px-4 py-2.5 text-left text-[14.5px] leading-relaxed text-paper-50 shadow-bubble-user transition",
              message.requestId
                ? "cursor-text hover:bg-ink-800 focus:outline-none focus:ring-2 focus:ring-terra-200/60"
                : "cursor-default",
            )}
            aria-label="编辑这条消息"
          >
            {message.content}
          </button>
          <MessageActions
            content={message.content}
            placement="right"
            hasRequestId={!!message.requestId}
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
          <MarkdownRenderer
            className="mt-1 min-w-0"
            contentClassName="text-[14.5px] leading-[1.72] text-ink-800"
          >
            {message.content}
          </MarkdownRenderer>
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
          onRegenerate={onRegenerate}
          onDelete={onDelete}
          onViewWorkflow={onViewWorkflow}
        />
      </div>
    </div>
  );
}

function MessageActions({
  content,
  placement,
  hasRequestId,
  onRegenerate,
  onDelete,
  onViewWorkflow,
}: {
  content: string;
  placement: "left" | "right";
  hasRequestId: boolean;
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
      {hasRequestId ? (
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
  children: React.ReactNode;
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

function formatModelProviderName(provider?: ModelProviderMetadata | ModelProviderListItem): string {
  if (!provider) return "AI 助手";
  const title = provider.title?.trim();
  const model = provider.model?.trim();
  if (title && model && normalizeModelDisplayName(title) !== normalizeModelDisplayName(model)) return `${title} · ${model}`;
  return title || model || "AI 助手";
}

function normalizeModelDisplayName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

// ---------- 流式占位 ----------

function StreamingRow({
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
      <Avatar role="assistant" icon={assistantAvatarIcon} pulsing />
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

function Avatar({
  role,
  icon,
  profile,
  pulsing = false,
}: {
  role: "user" | "assistant";
  icon?: string;
  profile?: UserProfile;
  pulsing?: boolean;
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
          "grid h-8 w-8 place-items-center rounded-xl text-ink-700",
          hasIcon ? "bg-paper-50 ring-1 ring-ink-200" : "bg-transparent",
        )}
      >
        {hasIcon ? <ModelProviderIcon icon={icon} size={18} /> : null}
      </div>
      {pulsing ? <span className="absolute -inset-1 rounded-[1rem] ring-2 ring-terra-300/60 animate-pulse" /> : null}
    </div>
  );
}

function readUserInitial(name?: string): string {
  return name?.trim().slice(0, 1).toUpperCase() ?? "";
}

function readSelectedModelProvider(
  models: ModelProviderListItem[],
  selectedId: string | null,
): ModelProviderListItem | undefined {
  return models.find((model) => model.id === selectedId) ?? models.find((model) => model.isDefault);
}

// ---------- 输入区 ----------

interface InputBarProps {
  disabled: boolean;
  running: boolean;
  modelProviders: ModelProviderListItem[];
  selectedModelProviderId: string | null;
  onSelectModelProvider: (id: string) => void;
  socketStatus: string;
  onSend: (input: string) => void;
  onCancel: () => void;
}

function InputBar({
  disabled,
  running,
  modelProviders,
  selectedModelProviderId,
  onSelectModelProvider,
  socketStatus,
  onSend,
  onCancel,
}: InputBarProps): JSX.Element {
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const hint = useMemo(() => {
    if (running) return "正在思考——可按 Esc 中断";
    if (socketStatus === "open") return "向 senera 发个问题…";
    if (socketStatus === "connecting" || socketStatus === "idle") return "正在连接后端…";
    return "后端未连接，请检查服务";
  }, [socketStatus, running]);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        taRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && running) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [running, onCancel]);

  const submit = (): void => {
    const text = value.trim();
    if (!text || disabled || running) return;
    onSend(text);
    setValue("");
    if (taRef.current) taRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  };

  const canSend = !disabled && !running && value.trim().length > 0;

  return (
    <div className="border-t border-ink-200/60 bg-paper-50 px-6 pb-6 pt-3">
      <div
        className={cn(
          "mx-auto flex max-w-3xl flex-col gap-1.5 rounded-2xl border border-ink-200 bg-paper-100/80 px-3 py-2 shadow-bubble-ai transition",
          "focus-within:border-ink-300 focus-within:bg-paper-50",
        )}
      >
        <div className="flex items-end gap-2">
          <Tooltip content="附加文件（待接入）" side="top">
            <button
              type="button"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-ink-500 transition hover:bg-ink-900/[0.05] hover:text-ink-800"
              aria-label="attach"
              disabled={running}
            >
              <Paperclip className="h-4 w-4" />
            </button>
          </Tooltip>
          <textarea
            ref={taRef}
            value={value}
            rows={1}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={hint}
            disabled={running}
            className="scrollbar-thin max-h-[240px] flex-1 resize-none bg-transparent py-2 text-[14.5px] leading-6 text-ink-900 placeholder:text-ink-400 focus:outline-none disabled:opacity-60"
          />
          {running ? (
            <Tooltip content="中断当前运行" side="top" shortcut="Esc">
              <button
                type="button"
                onClick={onCancel}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brick-500 text-paper-50 transition hover:bg-brick-600"
                aria-label="cancel"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            </Tooltip>
          ) : (
            <Tooltip content="发送" side="top" shortcut="↵">
              <button
                type="button"
                onClick={submit}
                disabled={!canSend}
                className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-xl transition",
                  canSend ? "bg-ink-900 text-paper-50 hover:bg-terra-500" : "bg-ink-200/60 text-ink-400",
                )}
                aria-label="send"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
        </div>
        <div className="flex items-center justify-between px-1 font-mono text-[10.5px] text-ink-400">
          <span>
            {running ? (
              <>
                <kbd className="rounded border border-ink-200 bg-paper-50 px-1 text-ink-600">Esc</kbd>
                <span className="ml-1.5">中断当前运行</span>
              </>
            ) : (
              <>
                <kbd className="rounded border border-ink-200 bg-paper-50 px-1 text-ink-600">⌘K</kbd>
                <span className="ml-1.5">聚焦输入</span>
                <span className="mx-2 text-ink-300">·</span>
                <kbd className="rounded border border-ink-200 bg-paper-50 px-1 text-ink-600">⇧↵</kbd>
                <span className="ml-1.5">换行</span>
              </>
            )}
          </span>
          <ModelSelector
            disabled={disabled || running}
            models={modelProviders}
            selectedId={selectedModelProviderId}
            onSelect={onSelectModelProvider}
          />
        </div>
      </div>
    </div>
  );
}

function ModelSelector({
  disabled,
  models,
  selectedId,
  onSelect,
}: {
  disabled: boolean;
  models: ModelProviderListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const selected = useMemo(
    () => readSelectedModelProvider(models, selectedId) ?? null,
    [models, selectedId],
  );
  const label = selected?.title ?? selected?.model ?? "...";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled || models.length === 0}>
        <button
          type="button"
          className={cn(
            "inline-flex h-7 min-w-0 max-w-[230px] items-center gap-1.5 rounded-md px-2 text-[11px]",
            "text-ink-500 transition hover:bg-ink-900/[0.045] hover:text-ink-800",
            "focus:outline-none focus:ring-2 focus:ring-terra-200/60",
            (disabled || models.length === 0) && "pointer-events-none opacity-55",
          )}
          aria-label="选择模型"
        >
          <ModelProviderIcon
            className="shrink-0"
            icon={selected?.icon}
            size={14}
          />
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-ink-350" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-[280px]">
        <DropdownMenuLabel>模型</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {models.map((model) => {
          const active = model.id === selected?.id;
          return (
            <DropdownMenuItem
              key={model.id}
              onSelect={() => onSelect(model.id)}
              className="h-auto items-start py-2"
              icon={active
                ? <Check className="h-3.5 w-3.5 text-terra-500" />
                : (
                  <ModelProviderIcon
                    icon={model.icon}
                    size={14}
                  />
                )}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[13px] text-ink-850">{model.title}</span>
                <span className="truncate font-mono text-[10.5px] text-ink-400">
                  {model.endpoint} · {model.model}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
