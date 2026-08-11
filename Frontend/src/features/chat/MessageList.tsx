import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import type { InteractionInputAction, InteractionInputContent } from "../../api/eventTypes";
import type { ApprovalBatchReference, ApprovalDecision } from "../../api/approvalEventTypes";
import type { ChatMessage, RunRecord, UserProfile } from "../../store/sessionStore";
import { useResponsiveMode } from "../../shared/responsive";
import { useMotionLevel } from "../../shared/motion";
import { PerformanceMonitor } from "../../app/PerformanceMonitor";
import { DeleteMessageDialog } from "./DeleteMessageDialog";
import { MessageRow } from "./MessageRow";
import { MotionMessageItem } from "./MotionMessageItem";
import { ScrollToBottomButton } from "./ScrollToBottomButton";
import { StreamingRow } from "./StreamingRow";
import { useMessageHeightObserver } from "./useMessageHeightObserver";
import { useStreamingDisplayTicker } from "./useStreamingDisplayTicker";
import { useVirtuosoAutoStickToBottom } from "./useVirtuosoAutoStickToBottom";
import {
  ConversationEventRail,
  projectConversationEvents,
  readConversationEventIndex,
  type ConversationEventKind,
  type ConversationEventSourceItem,
} from "./ConversationEventRail";

interface MessageListProps {
  sessionId: string;
  uploadUrl: string;
  messages: ChatMessage[];
  runs: RunRecord[];
  currentRun?: RunRecord;
  userProfile: UserProfile;
  onForkFromMessage: (m: ChatMessage) => void;
  onRegenerate: (m: ChatMessage) => void;
  onEditUserMessage: (m: ChatMessage, nextContent: string) => void;
  onDeleteFromMessage: (m: ChatMessage) => void;
  onViewWorkflow: (m: ChatMessage) => void;
  onResolveApproval?: (approvalId: string, decision: ApprovalDecision) => void;
  onResolveApprovalBatch?: (batch: ApprovalBatchReference, decision: ApprovalDecision) => void;
  onResolveInteractionInput?: (
    interactionId: string,
    action: InteractionInputAction,
    content?: InteractionInputContent,
  ) => void;
  approvalDisabled?: boolean;
}

const MESSAGE_LIST_BOTTOM_THRESHOLD = 80;
const MESSAGE_ITEM_DEFAULT_HEIGHT = 132;
const MESSAGE_LIST_OVERSCAN_PX = 240;
const EVENT_NAVIGATION_SETTLE_MS = 320;

type MessageListItem = ChatMessage | { __streaming: true; run: RunRecord };

function isStreamingListItem(
  item: MessageListItem | undefined,
): item is Extract<MessageListItem, { __streaming: true }> {
  if (!item) return false;
  return "__streaming" in item;
}

export function readMessageListItemKey(item: MessageListItem | undefined, fallbackIndex?: number): string {
  if (!item) return `__placeholder__:${fallbackIndex ?? "unknown"}`;
  return isStreamingListItem(item) ? "__streaming__" : item.id;
}

function readMeasuredMessageKey(element: HTMLElement): string | null {
  return (
    element.dataset.messageKey ?? element.querySelector<HTMLElement>("[data-message-key]")?.dataset.messageKey ?? null
  );
}

export function MessageList({
  sessionId,
  uploadUrl,
  messages,
  runs,
  currentRun,
  userProfile,
  onForkFromMessage,
  onRegenerate,
  onEditUserMessage,
  onDeleteFromMessage,
  onViewWorkflow,
  onResolveApproval,
  onResolveApprovalBatch,
  onResolveInteractionInput,
  approvalDisabled = false,
}: MessageListProps): JSX.Element {
  const { reduceMotion, disableMotion } = useMotionLevel();
  const { prefersCompactControls, supportsHover } = useResponsiveMode();
  const showInlineMessageActions = prefersCompactControls || !supportsHover;
  const [editing, setEditing] = useState<{ id: string; message: ChatMessage } | null>(null);
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<ChatMessage | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const measuredHeightsRef = useRef<Map<string, number>>(new Map());
  const [eventMeasuredHeights, setEventMeasuredHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const heightLayoutFrameRef = useRef<number | null>(null);
  const eventNavigationTimerRef = useRef<number | null>(null);
  const activeEventSessionRef = useRef(sessionId);
  const previousStreamingRunIdRef = useRef<string | null>(null);
  const highlightedRunIdsRef = useRef<Set<string>>(new Set());
  const chatScrollerRef = useRef<HTMLElement | null>(null);
  const [chatScroller, setChatScroller] = useState<HTMLElement | null>(null);
  const [activeEventIndex, setActiveEventIndex] = useState(0);
  const [completedRunIdToHighlight, setCompletedRunIdToHighlight] = useState<string | null>(null);
  const runsByRequestId = useMemo(() => {
    const map = new Map<string, RunRecord>();
    for (const run of runs) map.set(run.requestId, run);
    return map;
  }, [runs]);
  const streamingRun = currentRun?.status === "running" || currentRun?.status === "cancelling" ? currentRun : undefined;
  const displayedMessages = useMemo(
    () => (streamingRun ? messages.filter((message) => !shouldDeferTerminalMessage(message, streamingRun)) : messages),
    [messages, streamingRun],
  );
  const displayedMessageIds = useMemo(
    () => new Set(displayedMessages.map((message) => message.id)),
    [displayedMessages],
  );
  const items = useMemo(
    () =>
      streamingRun ? [...displayedMessages, { __streaming: true as const, run: streamingRun }] : displayedMessages,
    [displayedMessages, streamingRun],
  );
  const itemKeys = useMemo(() => items.map((item, index) => readMessageListItemKey(item, index)), [items]);
  const eventSourceItems = useMemo<ConversationEventSourceItem[]>(
    () =>
      items.map((item, index) =>
        isStreamingListItem(item)
          ? {
              key: readMessageListItemKey(item, index),
              requestId: item.run.requestId,
              eventKind: readStreamingConversationEventKind(
                item.run,
                item.run.displayMessageId !== undefined && displayedMessageIds.has(item.run.displayMessageId),
              ),
              content: item.run.displayText,
            }
          : {
              key: readMessageListItemKey(item, index),
              requestId: item.requestId,
              eventKind: readMessageConversationEventKind(item),
              content: item.content,
            },
      ),
    [displayedMessageIds, items],
  );
  const conversationEvents = useMemo(() => projectConversationEvents(eventSourceItems), [eventSourceItems]);
  const autoScroll = useVirtuosoAutoStickToBottom({
    itemCount: items.length,
    resetKey: sessionId,
    bottomThreshold: MESSAGE_LIST_BOTTOM_THRESHOLD,
  });
  const setAutoScrollScroller = autoScroll.scrollerRef;
  const beginManualScroll = autoScroll.beginManualScroll;
  const endManualScroll = autoScroll.endManualScroll;

  useStreamingDisplayTicker(sessionId, runs);

  // 清理旧会话的高度缓存
  useEffect(() => {
    measuredHeightsRef.current.clear();
    setEventMeasuredHeights(new Map());
  }, [sessionId]);

  const scheduleEventHeightSnapshot = useCallback((): void => {
    if (heightLayoutFrameRef.current !== null) return;
    heightLayoutFrameRef.current = window.requestAnimationFrame(() => {
      heightLayoutFrameRef.current = null;
      setEventMeasuredHeights(new Map(measuredHeightsRef.current));
    });
  }, []);

  const handleHeightMeasured = useCallback(
    (key: string, height: number) => {
      if (measuredHeightsRef.current.get(key) === height) return;
      measuredHeightsRef.current.set(key, height);
      scheduleEventHeightSnapshot();
    },
    [scheduleEventHeightSnapshot],
  );

  useEffect(
    () => () => {
      if (heightLayoutFrameRef.current !== null) window.cancelAnimationFrame(heightLayoutFrameRef.current);
      if (eventNavigationTimerRef.current !== null) window.clearTimeout(eventNavigationTimerRef.current);
    },
    [],
  );

  const heightObserverRef = useMessageHeightObserver(true, handleHeightMeasured);
  const measureMessageItemSize = useCallback(
    (element: HTMLElement, field: "offsetHeight" | "offsetWidth"): number => {
      const size = field === "offsetWidth" ? element.offsetWidth : element.offsetHeight;
      if (field === "offsetHeight") {
        const itemKey = readMeasuredMessageKey(element);
        if (itemKey && size > 0) {
          if (measuredHeightsRef.current.get(itemKey) !== size) {
            measuredHeightsRef.current.set(itemKey, size);
            scheduleEventHeightSnapshot();
          }
        } else if (itemKey) {
          return measuredHeightsRef.current.get(itemKey) ?? MESSAGE_ITEM_DEFAULT_HEIGHT;
        }
      }
      return size > 0 ? size : MESSAGE_ITEM_DEFAULT_HEIGHT;
    },
    [scheduleEventHeightSnapshot],
  );

  const setChatContainerScrollerRef = useCallback(
    (target: HTMLElement | Window | null): void => {
      if (chatScrollerRef.current && chatScrollerRef.current !== target) {
        delete chatScrollerRef.current.dataset.chatContainer;
      }
      if (target instanceof HTMLElement) {
        target.dataset.chatContainer = "true";
        chatScrollerRef.current = target;
        setChatScroller((current) => (current === target ? current : target));
      } else {
        chatScrollerRef.current = null;
        setChatScroller(null);
      }
      setAutoScrollScroller(target);
    },
    [setAutoScrollScroller],
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

  useEffect(() => {
    const lastEventIndex = Math.max(0, conversationEvents.length - 1);
    const sessionChanged = activeEventSessionRef.current !== sessionId;
    activeEventSessionRef.current = sessionId;
    setActiveEventIndex((current) =>
      sessionChanged || isAtBottom ? lastEventIndex : Math.min(current, lastEventIndex),
    );
  }, [conversationEvents.length, isAtBottom, sessionId]);

  const navigateToEvent = useCallback(
    (event: (typeof conversationEvents)[number]): void => {
      beginManualScroll();
      autoScroll.ref.current?.scrollToIndex({
        index: event.itemIndex,
        align: "start",
        behavior: reduceMotion || disableMotion ? "auto" : "smooth",
      });
      const nextIndex = conversationEvents.findIndex((candidate) => candidate.id === event.id);
      if (nextIndex >= 0) setActiveEventIndex(nextIndex);
      if (eventNavigationTimerRef.current !== null) window.clearTimeout(eventNavigationTimerRef.current);
      eventNavigationTimerRef.current = window.setTimeout(
        () => {
          eventNavigationTimerRef.current = null;
          endManualScroll();
        },
        reduceMotion || disableMotion ? 0 : EVENT_NAVIGATION_SETTLE_MS,
      );
    },
    [autoScroll.ref, beginManualScroll, conversationEvents, disableMotion, endManualScroll, reduceMotion],
  );

  return (
    <PerformanceMonitor id="MessageList" enabled={import.meta.env.DEV}>
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
          rangeChanged={(range) => {
            setActiveEventIndex(readConversationEventIndex(conversationEvents, range.startIndex));
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
                  className="chat-message-item box-border w-full pb-3 pt-1"
                  data-message-key={itemKey}
                  ref={heightObserverRef}
                >
                  <MotionMessageItem motionKey={`streaming:${item.run.requestId}`}>
                    <StreamingRow
                      sessionId={sessionId}
                      run={item.run}
                      hasActiveToolPrefaceMessage={
                        item.run.displayMessageId !== undefined && displayedMessageIds.has(item.run.displayMessageId)
                      }
                      approvalDisabled={approvalDisabled}
                      onResolveApproval={onResolveApproval}
                      onResolveApprovalBatch={onResolveApprovalBatch}
                      onResolveInteractionInput={onResolveInteractionInput}
                    />
                  </MotionMessageItem>
                </div>
              );
            }
            const shouldHighlightCompletedStream =
              item.role === "assistant" && item.requestId === completedRunIdToHighlight;
            const isRecentMessage = index >= displayedMessages.length - 2;
            const shouldAnimateMount = shouldHighlightCompletedStream || isRecentMessage;
            return (
              <div
                className="chat-message-item box-border w-full pb-3 pt-1"
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
                    uploadUrl={uploadUrl}
                    onClickBubble={() => {
                      if (item.role !== "user") return;
                      if (!item.requestId) return;
                      setEditing({ id: item.id, message: item });
                      setDraft(item.content ?? "");
                    }}
                    isEditing={editing?.id === item.id}
                    editDraft={editing?.id === item.id ? draft : ""}
                    onEditDraftChange={setDraft}
                    onCancelEdit={closeEditor}
                    onSubmitEdit={() => {
                      if (editing?.id !== item.id) return;
                      const next = draft.trim();
                      if (!next) return;
                      onEditUserMessage(item, next);
                      closeEditor();
                    }}
                    userProfile={userProfile}
                    showInlineActions={showInlineMessageActions}
                    onFork={() => onForkFromMessage(item)}
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
            Footer: () => <div className="h-3" data-message-list-end-spacer />,
          }}
        />
        <ConversationEventRail
          events={conversationEvents}
          itemKeys={itemKeys}
          measuredHeights={eventMeasuredHeights}
          defaultItemHeight={MESSAGE_ITEM_DEFAULT_HEIGHT}
          activeEventIndex={activeEventIndex}
          scroller={chatScroller}
          reducedMotion={reduceMotion || disableMotion}
          onActiveEventChange={setActiveEventIndex}
          onNavigate={navigateToEvent}
          onManualScrollStart={beginManualScroll}
          onManualScrollEnd={endManualScroll}
        />
        <ScrollToBottomButton visible={showScrollButton} onClick={scrollToBottom} />
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
    </PerformanceMonitor>
  );
}

function shouldDeferTerminalMessage(message: ChatMessage, run: RunRecord): boolean {
  return (
    message.id === run.displayMessageId &&
    run.outputState !== "available" &&
    run.outputState !== "committed" &&
    (run.visibleKind === "final_answer" || run.visibleKind === "ask_user")
  );
}

function readMessageConversationEventKind(message: ChatMessage): ConversationEventKind | null {
  if (message.role === "user") return "user_request";
  if (message.role === "system") return null;
  switch (message.kind) {
    case "AssistantToolPreface":
      return "assistant_tool_preface";
    case "AssistantFinal":
      return "assistant_final";
    case "AssistantAsk":
      return "assistant_ask";
    case "Error":
      return "assistant_error";
    default:
      return "assistant_final";
  }
}

function readStreamingConversationEventKind(
  run: RunRecord,
  hasVisibleDisplayMessage: boolean,
): ConversationEventKind | null {
  if (hasVisibleDisplayMessage) return null;
  switch (run.visibleKind) {
    case "tool_preface":
      return "assistant_tool_preface";
    case "final_answer":
      return "assistant_final";
    case "ask_user":
      return "assistant_ask";
    case "unknown":
    case "tool_calls":
      return null;
  }
}
