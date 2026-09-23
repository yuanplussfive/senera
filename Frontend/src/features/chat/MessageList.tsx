import {
  lazy,
  startTransition,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { InteractionInputAction, InteractionInputContent } from "../../api/eventTypes";
import type { ChatMessage, RunRecord, UserProfile } from "../../store/sessionStore";
import type { CalculateViewLocation } from "react-virtuoso";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { useResponsiveMode } from "../../shared/responsive";
import { useMotionLevel } from "../../shared/motion";
import { PerformanceMonitor } from "../../app/PerformanceMonitor";
import { AssistantTurnRow } from "./AssistantTurnRow";
import { ChatLoadingSurface } from "./ChatLoadingSurface";
import { DeleteMessageDialog } from "./DeleteMessageDialog";
import { MessageRow } from "./MessageRow";
import { MotionMessageItem } from "./MotionMessageItem";
import { ScrollToBottomButton } from "./ScrollToBottomButton";
import {
  isAssistantTurnListItem,
  projectAssistantTurns,
  readAssistantTurnAnchorId,
  type ProjectedMessageListItem,
} from "./assistantTurnProjection";
import { useMessageHeightObserver } from "./useMessageHeightObserver";
import { useStreamingDisplayTicker } from "./useStreamingDisplayTicker";
import { useVirtuosoAutoStickToBottom } from "./useVirtuosoAutoStickToBottom";
import { scheduleIdleTask } from "../../shared/scheduling/scheduleIdleTask";
import {
  ConversationEventRail,
  projectConversationEvents,
  type ConversationEventKind,
  type ConversationEventSourceItem,
} from "./ConversationEventRail";

interface MessageListProps {
  sessionId: string;
  uploadUrl: string;
  historyHydrating?: boolean;
  messages: ChatMessage[];
  runs: RunRecord[];
  currentRun?: RunRecord;
  userProfile: UserProfile;
  onForkFromMessage: (message: Pick<ChatMessage, "requestId">) => void;
  onRegenerate: (m: ChatMessage) => void;
  onEditUserMessage: (m: ChatMessage, nextContent: string) => void;
  onDeleteFromMessage: (m: ChatMessage) => void;
  onViewWorkflow: (m: ChatMessage) => void;
  onResolveInteractionInput?: (
    interactionId: string,
    action: InteractionInputAction,
    content?: InteractionInputContent,
  ) => void;
}

const MESSAGE_LIST_BOTTOM_THRESHOLD = 80;
const MESSAGE_ITEM_DEFAULT_HEIGHT = 132;
const MESSAGE_LIST_FORWARD_OVERSCAN_PX = 160;
const MESSAGE_LIST_REVERSE_OVERSCAN_PX = 96;
// The rail is navigational chrome, so update it after the message layout settles instead
// of competing with image decoding and inertial scrolling on every ResizeObserver entry.
const EVENT_RAIL_HEIGHT_SAMPLE_MS = 160;

const forceCenterEventLocation: CalculateViewLocation = ({ locationParams }) => ({
  ...locationParams,
  align: "center",
});

const LazyMessageListVirtualizer = lazy(() =>
  import("./MessageListVirtualizer").then((module) => ({ default: module.MessageListVirtualizer })),
);

type MessageListItem = ProjectedMessageListItem;

export function readMessageListItemKey(item: MessageListItem | undefined, fallbackIndex?: number): string {
  if (!item) return `__placeholder__:${fallbackIndex ?? "unknown"}`;
  return isAssistantTurnListItem(item) ? item.key : item.id;
}

function readMeasuredMessageKey(element: HTMLElement): string | null {
  return (
    element.dataset.messageKey ?? element.querySelector<HTMLElement>("[data-message-key]")?.dataset.messageKey ?? null
  );
}

/** Keep reply navigation inside the chat scroller instead of scrolling every ancestor. */
export function scrollConversationAnchorIntoView(scroller: HTMLElement, anchor: HTMLElement): void {
  const scrollerRect = scroller.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const targetTop = Math.min(
    maxScrollTop,
    Math.max(
      0,
      scroller.scrollTop + anchorRect.top - scrollerRect.top - (scroller.clientHeight - anchorRect.height) / 2,
    ),
  );

  if (Math.abs(targetTop - scroller.scrollTop) < 1) return;
  scroller.scrollTo({ top: targetTop, behavior: "auto" });
}

export function MessageList({
  sessionId,
  uploadUrl,
  historyHydrating = false,
  messages,
  runs,
  currentRun,
  userProfile,
  onForkFromMessage,
  onRegenerate,
  onEditUserMessage,
  onDeleteFromMessage,
  onViewWorkflow,
  onResolveInteractionInput,
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
  const eventHeightSampleTimerRef = useRef<number | null>(null);
  const eventNavigationTokenRef = useRef(0);
  const eventNavigationLockRef = useRef(false);
  const eventNavigationSettleFrameRef = useRef<number | null>(null);
  const activeEventSessionRef = useRef(sessionId);
  const previousStreamingRunIdRef = useRef<string | null>(null);
  const highlightedRunIdsRef = useRef<Set<string>>(new Set());
  const chatScrollerRef = useRef<HTMLElement | null>(null);
  const [chatScroller, setChatScroller] = useState<HTMLElement | null>(null);
  const [activeEventIndex, setActiveEventIndex] = useState(0);
  const [completedRunIdToHighlight, setCompletedRunIdToHighlight] = useState<string | null>(null);
  const [eventRailReady, setEventRailReady] = useState(!historyHydrating);
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
  const deferredMessages = useDeferredValue(displayedMessages);
  const deferredRuns = useDeferredValue(runs);
  const deferredStreamingRun = useDeferredValue(streamingRun);
  const items = useMemo(
    () => projectAssistantTurns(deferredMessages, deferredRuns, deferredStreamingRun),
    [deferredMessages, deferredRuns, deferredStreamingRun],
  );
  // Keep the socket/store path responsive while a large history projection is
  // being committed. React can paint the previous window first and reconcile
  // the new list at lower priority without changing the durable session state.
  const renderedItems = items;
  useEffect(() => {
    if (historyHydrating) {
      setEventRailReady(false);
      return;
    }
    return scheduleIdleTask(() => setEventRailReady(true), { priority: "user-visible" });
  }, [historyHydrating]);
  const shouldRenderEventRail = !historyHydrating && eventRailReady;
  const itemKeys = useMemo(
    () => (shouldRenderEventRail ? renderedItems.map((item, index) => readMessageListItemKey(item, index)) : []),
    [renderedItems, shouldRenderEventRail],
  );
  const eventSourceItems = useMemo<ConversationEventSourceItem[]>(() => {
    if (!shouldRenderEventRail) return [];
    return renderedItems.flatMap((item, index): ConversationEventSourceItem[] => {
      if (!isAssistantTurnListItem(item)) {
        return [
          {
            key: readMessageListItemKey(item, index),
            requestId: item.requestId,
            eventKind: readMessageConversationEventKind(item),
            content: item.content,
            itemIndex: index,
          },
        ];
      }

      const sources: ConversationEventSourceItem[] = item.messages.map((message, messageIndex) => ({
        key: message.id,
        requestId: message.requestId,
        eventKind: readMessageConversationEventKind(message),
        content: message.content,
        itemIndex: index,
        itemProgress: readTurnEventProgress(messageIndex, item.messages.length, message.kind),
        anchorId: readAssistantTurnAnchorId(message),
      }));
      const transientKind = item.run
        ? readStreamingConversationEventKind(
            item.run,
            item.run.displayMessageId !== undefined && displayedMessageIds.has(item.run.displayMessageId),
          )
        : null;
      if (item.streaming && transientKind) {
        sources.push({
          key: `${item.key}:streaming`,
          requestId: item.requestId,
          eventKind: transientKind,
          content: item.run?.displayText ?? "",
          itemIndex: index,
          itemProgress: 0.82,
        });
      }
      return sources;
    });
  }, [displayedMessageIds, renderedItems, shouldRenderEventRail]);
  const conversationEvents = useMemo(() => projectConversationEvents(eventSourceItems), [eventSourceItems]);
  const autoScroll = useVirtuosoAutoStickToBottom({
    itemCount: renderedItems.length,
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
    eventNavigationTokenRef.current += 1;
    eventNavigationLockRef.current = false;
    if (eventNavigationSettleFrameRef.current !== null) {
      window.cancelAnimationFrame(eventNavigationSettleFrameRef.current);
      eventNavigationSettleFrameRef.current = null;
    }
  }, [sessionId]);

  const scheduleEventHeightSnapshot = useCallback((): void => {
    if (eventHeightSampleTimerRef.current !== null) return;
    eventHeightSampleTimerRef.current = window.setTimeout(() => {
      eventHeightSampleTimerRef.current = null;
      startTransition(() => setEventMeasuredHeights(new Map(measuredHeightsRef.current)));
    }, EVENT_RAIL_HEIGHT_SAMPLE_MS);
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
      if (eventHeightSampleTimerRef.current !== null) window.clearTimeout(eventHeightSampleTimerRef.current);
      eventNavigationTokenRef.current += 1;
      eventNavigationLockRef.current = false;
      if (eventNavigationSettleFrameRef.current !== null) {
        window.cancelAnimationFrame(eventNavigationSettleFrameRef.current);
        eventNavigationSettleFrameRef.current = null;
      }
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
    if (renderedItems.length === 0) return;
    const behavior = reduceMotion || disableMotion ? "auto" : "smooth";
    autoScroll.scrollToBottom(behavior);
  };

  const showScrollButton = !isAtBottom && renderedItems.length > 0;

  useEffect(() => {
    if (eventNavigationLockRef.current) return;
    const lastEventIndex = Math.max(0, conversationEvents.length - 1);
    const sessionChanged = activeEventSessionRef.current !== sessionId;
    activeEventSessionRef.current = sessionId;
    setActiveEventIndex((current) =>
      sessionChanged || isAtBottom ? lastEventIndex : Math.min(current, lastEventIndex),
    );
  }, [conversationEvents.length, isAtBottom, sessionId]);

  const updateActiveEventIndex = useCallback((index: number): void => {
    if (eventNavigationLockRef.current) return;
    setActiveEventIndex(index);
  }, []);

  const navigateToEvent = useCallback(
    (event: (typeof conversationEvents)[number]): void => {
      const navigationToken = eventNavigationTokenRef.current + 1;
      eventNavigationTokenRef.current = navigationToken;
      eventNavigationLockRef.current = true;
      if (eventNavigationSettleFrameRef.current !== null) {
        window.cancelAnimationFrame(eventNavigationSettleFrameRef.current);
        eventNavigationSettleFrameRef.current = null;
      }
      beginManualScroll();
      const nextIndex = conversationEvents.findIndex((candidate) => candidate.id === event.id);
      if (nextIndex >= 0) setActiveEventIndex(nextIndex);

      const finishNavigation = (): void => {
        if (eventNavigationTokenRef.current !== navigationToken) return;
        let framesRemaining = 1;
        const settle = (): void => {
          eventNavigationSettleFrameRef.current = null;
          if (eventNavigationTokenRef.current !== navigationToken) return;
          const scroller = chatScrollerRef.current;
          const anchor = event.anchorId ? document.getElementById(event.anchorId) : null;
          const anchorReady = !event.anchorId || (scroller !== null && anchor !== null && scroller.contains(anchor));
          if (!anchorReady && framesRemaining > 0) {
            framesRemaining -= 1;
            eventNavigationSettleFrameRef.current = window.requestAnimationFrame(settle);
            return;
          }
          if (scroller && anchor && scroller.contains(anchor)) {
            // Virtuoso owns row discovery; this one direct scroll owns exact reply alignment.
            scrollConversationAnchorIntoView(scroller, anchor);
          }
          if (framesRemaining > 0) {
            framesRemaining -= 1;
            eventNavigationSettleFrameRef.current = window.requestAnimationFrame(settle);
            return;
          }
          eventNavigationLockRef.current = false;
          endManualScroll();
        };
        eventNavigationSettleFrameRef.current = window.requestAnimationFrame(settle);
      };

      const behavior = reduceMotion || disableMotion ? "auto" : "smooth";
      const handle = autoScroll.ref.current;
      if (!handle) {
        finishNavigation();
        return;
      }

      handle.scrollIntoView({
        index: event.itemIndex,
        align: "center",
        behavior,
        calculateViewLocation: forceCenterEventLocation,
        done: finishNavigation,
      });
    },
    [autoScroll.ref, beginManualScroll, conversationEvents, disableMotion, endManualScroll, reduceMotion],
  );

  return (
    <PerformanceMonitor id="MessageList" enabled={import.meta.env.DEV}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <Suspense fallback={<MessageListVirtualizerLoadingState />}>
          <LazyMessageListVirtualizer
            ref={autoScroll.ref}
            scrollerRef={setChatContainerScrollerRef}
            style={{ flex: 1, minHeight: 0 }}
            data={renderedItems}
            totalCount={renderedItems.length}
            followOutput={autoScroll.followOutput}
            atBottomStateChange={(atBottom) => {
              autoScroll.atBottomStateChange(atBottom);
              setIsAtBottom(atBottom);
            }}
            totalListHeightChanged={autoScroll.totalListHeightChanged}
            defaultItemHeight={MESSAGE_ITEM_DEFAULT_HEIGHT}
            initialTopMostItemIndex={{ index: Math.max(0, renderedItems.length - 1), align: "end" }}
            atBottomThreshold={MESSAGE_LIST_BOTTOM_THRESHOLD}
            overscan={{ main: MESSAGE_LIST_FORWARD_OVERSCAN_PX, reverse: MESSAGE_LIST_REVERSE_OVERSCAN_PX }}
            computeItemKey={(index, item) => readMessageListItemKey(item, index)}
            itemSize={measureMessageItemSize}
            itemContent={(index, item) => {
              const itemKey = readMessageListItemKey(item, index);
              if (!item) return <div className="h-px" data-message-key={itemKey} />;
              if (isAssistantTurnListItem(item)) {
                const shouldHighlightCompletedStream = item.requestId === completedRunIdToHighlight;
                const shouldAnimateMount =
                  !item.streaming && (shouldHighlightCompletedStream || index >= renderedItems.length - 2);
                return (
                  <div
                    className="chat-message-item box-border w-full pb-3 pt-1"
                    data-message-key={itemKey}
                    ref={heightObserverRef}
                  >
                    <MotionMessageItem
                      motionKey={item.key}
                      animateOnMount={shouldAnimateMount}
                      className={shouldHighlightCompletedStream ? "streaming-complete-highlight" : undefined}
                    >
                      <AssistantTurnRow
                        sessionId={sessionId}
                        turn={item}
                        showInlineActions={showInlineMessageActions}
                        onForkFromMessage={onForkFromMessage}
                        onRegenerate={onRegenerate}
                        onDeleteFromMessage={setDeleting}
                        onViewWorkflow={onViewWorkflow}
                        onResolveInteractionInput={onResolveInteractionInput}
                      />
                    </MotionMessageItem>
                  </div>
                );
              }
              const shouldAnimateMount = index >= renderedItems.length - 2;
              return (
                <div
                  className="chat-message-item box-border w-full pb-3 pt-1"
                  data-message-key={itemKey}
                  ref={heightObserverRef}
                >
                  <MotionMessageItem motionKey={item.id} animateOnMount={shouldAnimateMount}>
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
        </Suspense>
        <ConversationEventRail
          events={conversationEvents}
          itemKeys={itemKeys}
          measuredHeights={eventMeasuredHeights}
          defaultItemHeight={MESSAGE_ITEM_DEFAULT_HEIGHT}
          activeEventIndex={activeEventIndex}
          scroller={chatScroller}
          onActiveEventChange={updateActiveEventIndex}
          onNavigate={navigateToEvent}
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

function MessageListVirtualizerLoadingState(): JSX.Element {
  return (
    <div className="min-h-0 flex-1" data-message-list-loading>
      <ChatLoadingSurface label={frontendMessage("ui.loading")} />
    </div>
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
      return null;
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
      return null;
    case "final_answer":
      return "assistant_final";
    case "ask_user":
      return "assistant_ask";
    case "unknown":
    case "tool_calls":
      return null;
  }
}

function readTurnEventProgress(messageIndex: number, messageCount: number, kind: ChatMessage["kind"]): number {
  if (kind === "AssistantFinal" || kind === "AssistantAsk" || kind === "Error") {
    // Keep multiple terminal landmarks inside one virtual row strictly ordered.
    return 0.7 + (0.24 * (messageIndex + 1)) / (messageCount + 1);
  }
  return (messageIndex + 1) / (messageCount + 1);
}
