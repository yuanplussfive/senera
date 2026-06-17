import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import type { ModelProviderListItem } from "../../api/eventTypes";
import type { ChatMessage, RunRecord, UserProfile } from "../../store/sessionStore";
import { DeleteMessageDialog } from "./DeleteMessageDialog";
import { EditMessageDialog } from "./EditMessageDialog";
import { MessageRow, StreamingRow } from "./MessageRow";
import { useVirtuosoAutoStickToBottom } from "./useVirtuosoAutoStickToBottom";
import { MotionMessageItem } from "./MotionMessageItem";
import { ScrollToBottomButton } from "./ScrollToBottomButton";
import { useMessageHeightObserver } from "./useMessageHeightObserver";
import { useMotionLevel } from "../../shared/motion";

interface MessageListProps {
  sessionId: string;
  messages: ChatMessage[];
  runs: RunRecord[];
  currentRun?: RunRecord;
  assistantAvatarIcon?: string;
  selectedModelProvider?: ModelProviderListItem;
  userProfile: UserProfile;
  onRegenerate: (m: ChatMessage) => void;
  onEditUserMessage: (m: ChatMessage, nextContent: string) => void;
  onDeleteFromMessage: (m: ChatMessage) => void;
  onViewWorkflow: (m: ChatMessage) => void;
}

const MESSAGE_LIST_BOTTOM_THRESHOLD = 80;
const MESSAGE_ITEM_DEFAULT_HEIGHT = 132;
const MESSAGE_LIST_OVERSCAN_PX = 240;

type MessageListItem = ChatMessage | { __streaming: true; run: RunRecord };

function isStreamingListItem(item: MessageListItem | undefined): item is Extract<MessageListItem, { __streaming: true }> {
  if (!item) return false;
  return "__streaming" in item;
}

export function readMessageListItemKey(item: MessageListItem | undefined, fallbackIndex?: number): string {
  if (!item) return `__placeholder__:${fallbackIndex ?? "unknown"}`;
  return isStreamingListItem(item) ? "__streaming__" : item.id;
}

function readMeasuredMessageKey(element: HTMLElement): string | null {
  return element.dataset.messageKey
    ?? element.querySelector<HTMLElement>("[data-message-key]")?.dataset.messageKey
    ?? null;
}

export function MessageList({
  sessionId,
  messages,
  runs,
  currentRun,
  assistantAvatarIcon,
  selectedModelProvider,
  userProfile,
  onRegenerate,
  onEditUserMessage,
  onDeleteFromMessage,
  onViewWorkflow,
}: MessageListProps): JSX.Element {
  const { reduceMotion, disableMotion } = useMotionLevel();
  const [editing, setEditing] = useState<{ id: string; message: ChatMessage } | null>(null);
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<ChatMessage | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const measuredHeightsRef = useRef<Map<string, number>>(new Map());
  const previousStreamingRunIdRef = useRef<string | null>(null);
  const highlightedRunIdsRef = useRef<Set<string>>(new Set());
  const chatScrollerRef = useRef<HTMLElement | null>(null);
  const [completedRunIdToHighlight, setCompletedRunIdToHighlight] = useState<string | null>(null);
  const runsByRequestId = useMemo(() => {
    const map = new Map<string, RunRecord>();
    for (const run of runs) map.set(run.requestId, run);
    return map;
  }, [runs]);
  const items = useMemo(
    () => (currentRun ? [...messages, { __streaming: true as const, run: currentRun }] : messages),
    [messages, currentRun],
  );
  const lastItemKey = items.length > 0 ? readMessageListItemKey(items[items.length - 1]) : "";
  const autoScroll = useVirtuosoAutoStickToBottom({
    itemCount: items.length,
    resetKey: sessionId,
    activityKey: `${lastItemKey}:${currentRun?.revision ?? 0}`,
    bottomThreshold: MESSAGE_LIST_BOTTOM_THRESHOLD,
  });

  // 清理旧会话的高度缓存
  useEffect(() => {
    measuredHeightsRef.current.clear();
  }, [sessionId]);

  const handleHeightMeasured = useCallback((key: string, height: number) => {
    measuredHeightsRef.current.set(key, height);
  }, []);

  const heightObserverRef = useMessageHeightObserver(true, handleHeightMeasured);
  const measureMessageItemSize = useCallback((element: HTMLElement, field: "offsetHeight" | "offsetWidth"): number => {
    const size = field === "offsetWidth" ? element.offsetWidth : element.offsetHeight;
    if (field === "offsetHeight") {
      const itemKey = readMeasuredMessageKey(element);
      if (itemKey && size > 0) {
        measuredHeightsRef.current.set(itemKey, size);
      } else if (itemKey) {
        return measuredHeightsRef.current.get(itemKey) ?? MESSAGE_ITEM_DEFAULT_HEIGHT;
      }
    }
    return size > 0 ? size : MESSAGE_ITEM_DEFAULT_HEIGHT;
  }, []);

  const setChatContainerScrollerRef = useCallback(
    (target: HTMLElement | Window | null): void => {
      if (chatScrollerRef.current && chatScrollerRef.current !== target) {
        delete chatScrollerRef.current.dataset.chatContainer;
      }
      if (target instanceof HTMLElement) {
        target.dataset.chatContainer = "true";
        chatScrollerRef.current = target;
      } else {
        chatScrollerRef.current = null;
      }
      autoScroll.scrollerRef(target);
    },
    [autoScroll.scrollerRef],
  );

  useEffect(() => {
    const currentStreamingRunId = currentRun?.requestId ?? null;
    const previousStreamingRunId = previousStreamingRunIdRef.current;
    previousStreamingRunIdRef.current = currentStreamingRunId;
    if (!previousStreamingRunId || currentStreamingRunId === previousStreamingRunId) return;
    if (highlightedRunIdsRef.current.has(previousStreamingRunId)) return;
    highlightedRunIdsRef.current.add(previousStreamingRunId);
    setCompletedRunIdToHighlight(previousStreamingRunId);
  }, [currentRun?.requestId]);

  useEffect(() => {
    if (!completedRunIdToHighlight) return;
    const id = window.setTimeout(() => setCompletedRunIdToHighlight(null), 900);
    return () => window.clearTimeout(id);
  }, [completedRunIdToHighlight]);

  const closeEditor = (): void => {
    setEditing(null);
    setDraft("");
  };

  const scrollToBottom = (): void => {
    if (items.length === 0) return;
    const behavior = reduceMotion || disableMotion ? "auto" : "smooth";
    autoScroll.scrollToBottom(behavior);
  };

  const showScrollButton = !isAtBottom && items.length > 0;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Virtuoso
        ref={autoScroll.ref}
        scrollerRef={setChatContainerScrollerRef}
        style={{ flex: 1, minHeight: 0 }}
        data={items}
        totalCount={items.length}
        followOutput={autoScroll.followOutput}
        atBottomStateChange={(atBottom) => {
          autoScroll.atBottomStateChange(atBottom);
          setIsAtBottom(atBottom);
        }}
        totalListHeightChanged={autoScroll.totalListHeightChanged}
        defaultItemHeight={MESSAGE_ITEM_DEFAULT_HEIGHT}
        initialTopMostItemIndex={{ index: Math.max(0, items.length - 1), align: "end" }}
        atBottomThreshold={MESSAGE_LIST_BOTTOM_THRESHOLD}
        overscan={{ main: MESSAGE_LIST_OVERSCAN_PX, reverse: MESSAGE_LIST_OVERSCAN_PX }}
        computeItemKey={(index, item) => readMessageListItemKey(item, index)}
        itemSize={measureMessageItemSize}
        itemContent={(index, item) => {
          const itemKey = readMessageListItemKey(item, index);
          if (!item) return <div className="h-px" data-message-key={itemKey} />;
          if (isStreamingListItem(item)) {
            return (
              <div
                className="chat-message-item mx-auto box-border w-full max-w-3xl px-4 pb-3 pt-1 sm:px-6"
                data-message-key={itemKey}
                ref={heightObserverRef}
              >
                <MotionMessageItem motionKey={`streaming:${item.run.requestId}`}>
                  <StreamingRow
                    run={item.run}
                    assistantAvatarIcon={assistantAvatarIcon}
                    selectedModelProvider={selectedModelProvider}
                  />
                </MotionMessageItem>
              </div>
            );
          }
          const shouldHighlightCompletedStream =
            item.role === "assistant" && item.requestId === completedRunIdToHighlight;
          const isRecentMessage = index >= messages.length - 2;
          const shouldAnimateMount = shouldHighlightCompletedStream || isRecentMessage;
          return (
            <div
              className="chat-message-item mx-auto box-border w-full max-w-3xl px-4 pb-3 pt-1 sm:px-6"
              data-message-key={itemKey}
              ref={heightObserverRef}
            >
              <MotionMessageItem
                motionKey={item.id}
                animateOnMount={shouldAnimateMount}
                className={shouldHighlightCompletedStream ? "streaming-complete-highlight" : undefined}
              >
                <MessageRow
                  message={item}
                  run={item.requestId ? runsByRequestId.get(item.requestId) : undefined}
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
                  onDelete={() => setDeleting(item)}
                  onViewWorkflow={() => onViewWorkflow(item)}
                />
              </MotionMessageItem>
            </div>
          );
        }}
        components={{
          Header: () => <div className="h-6" />,
          Footer: () => <div className="h-24" />,
        }}
      />
      <ScrollToBottomButton visible={showScrollButton} onClick={scrollToBottom} />
      <EditMessageDialog
        editing={editing}
        draft={draft}
        onDraftChange={setDraft}
        onClose={closeEditor}
        onSubmit={(target, next) => {
          onEditUserMessage(target, next);
          closeEditor();
        }}
      />
      <DeleteMessageDialog
        open={!!deleting}
        message={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={(target) => {
          onDeleteFromMessage(target);
          setDeleting(null);
        }}
      />
    </div>
  );
}
