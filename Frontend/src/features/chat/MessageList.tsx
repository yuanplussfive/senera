import {
  lazy,
  memo,
  Suspense,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AgentSessionHistoryWindow } from "../../../../Source/AgentSystem/Session/AgentSessionHistoryWindow";
import type { InteractionInputAction, InteractionInputContent } from "../../api/eventTypes";
import type { FeedbackCategory, FeedbackRating } from "../../api/feedbackEventTypes";
import type { ChatMessage, ConversationIdentity, RunRecord, UserProfile } from "../../store/sessionStore";
import type { CalculateViewLocation } from "react-virtuoso";
import { isSupersededFailure, readSupersededFailureIds } from "../../store/session/runRecoveryProjection";
import { useResponsiveMode } from "../../shared/responsive";
import { useMotionLevel } from "../../shared/motion";
import { PerformanceMonitor } from "../../app/PerformanceMonitor";
import { AssistantTurnRow } from "./AssistantTurnRow";
import { DeleteMessageDialog } from "./DeleteMessageDialog";
import { MessageRow } from "./MessageRow";
import { MotionMessageItem } from "./MotionMessageItem";
import { ChatLoadingSurface } from "./ChatLoadingSurface";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { ScrollToBottomButton } from "./ScrollToBottomButton";
import {
  isAssistantTurnListItem,
  projectAssistantTurns,
  readAssistantTurnAnchorId,
  readProjectedMessageListItemKeys,
  type ProjectedMessageListItem,
} from "./assistantTurnProjection";
import { useMessageHeightObserver } from "./useMessageHeightObserver";
import { ChatHistoryNavigation } from "./ChatHistoryNavigation";
import type { ChatNavigationActions } from "./ChatPanelContracts";
import { shouldAutoscrollForListHeightChange, useVirtuosoAutoStickToBottom } from "./useVirtuosoAutoStickToBottom";
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
  historyLoading?: boolean;
  historyWindow?: AgentSessionHistoryWindow;
  historyWindowLoading?: boolean;
  historyWindowFailed?: boolean;
  historyWindowDisabled?: boolean;
  onLoadHistory?: NonNullable<ChatNavigationActions["onLoadHistory"]>;
  messages: ChatMessage[];
  runs: RunRecord[];
  currentRun?: RunRecord;
  userProfile: UserProfile;
  assistantProfile?: ConversationIdentity;
  onForkFromMessage: (message: Pick<ChatMessage, "requestId">) => void;
  onRegenerate: (m: ChatMessage) => void;
  onRetryRun: (m: ChatMessage) => void;
  onContinueRun: (m: ChatMessage) => void;
  onEditUserMessage: (m: ChatMessage, nextContent: string) => void;
  onDeleteFromMessage: (m: ChatMessage) => void;
  onViewWorkflow: (m: ChatMessage) => void;
  onResolveInteractionInput?: (
    interactionId: string,
    action: InteractionInputAction,
    content?: InteractionInputContent,
  ) => void;
  onRecordMessageFeedback?: (
    sessionId: string,
    requestId: string,
    rating: FeedbackRating | null,
    category?: FeedbackCategory,
  ) => void;
}

const MESSAGE_LIST_BOTTOM_THRESHOLD = 80;
const MESSAGE_ITEM_DEFAULT_HEIGHT = 132;
const MESSAGE_LIST_FORWARD_OVERSCAN_PX = 160;
const MESSAGE_LIST_REVERSE_OVERSCAN_PX = 96;
// The rail is navigational chrome, so update it after the message layout settles instead
// of competing with image decoding and inertial scrolling on every ResizeObserver entry.
const EVENT_RAIL_HEIGHT_SAMPLE_MS = 160;

const messageListComponents = {
  Header: () => <div className="h-4" />,
  Footer: () => <div className="h-5" data-message-list-end-spacer />,
};

const forceCenterEventLocation: CalculateViewLocation = ({ locationParams }) => ({
  ...locationParams,
  align: "center",
});

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

export const MessageList = memo(function MessageList({
  sessionId,
  uploadUrl,
  historyHydrating = false,
  historyLoading = false,
  historyWindow,
  historyWindowLoading = false,
  historyWindowFailed = false,
  historyWindowDisabled = false,
  onLoadHistory,
  messages,
  runs,
  currentRun,
  userProfile,
  assistantProfile,
  onForkFromMessage,
  onRegenerate,
  onRetryRun,
  onContinueRun,
  onEditUserMessage,
  onDeleteFromMessage,
  onViewWorkflow,
  onResolveInteractionInput,
  onRecordMessageFeedback,
}: MessageListProps): JSX.Element {
  const { reduceMotion, disableMotion } = useMotionLevel();
  const { prefersCompactControls, supportsHover } = useResponsiveMode();
  const showInlineMessageActions = prefersCompactControls || !supportsHover;
  const [editing, setEditing] = useState<{ id: string; message: ChatMessage } | null>(null);
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<ChatMessage | null>(null);
  const [dismissedFailures, setDismissedFailures] = useState(() => {
    const superseded = readSupersededFailureIds({ runs });
    return new Set(messages.filter((message) => isSupersededFailure(message, superseded)).map((message) => message.id));
  });
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isAtTop, setIsAtTop] = useState(false);
  const measuredHeightsRef = useRef<Map<string, number>>(new Map());
  const [eventMeasuredHeights, setEventMeasuredHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const eventHeightSampleTimerRef = useRef<number | null>(null);
  const eventNavigationTokenRef = useRef(0);
  const eventNavigationLockRef = useRef(false);
  const eventNavigationSettleFrameRef = useRef<number | null>(null);
  const activeEventSessionRef = useRef(sessionId);
  const chatScrollerRef = useRef<HTMLElement | null>(null);
  const [chatScroller, setChatScroller] = useState<HTMLElement | null>(null);
  const [activeEventIndex, setActiveEventIndex] = useState(0);
  const [eventRailReady, setEventRailReady] = useState(false);
  const eventSourceItemsRef = useRef<readonly ConversationEventSourceItem[]>([]);
  const streamingRun = currentRun?.status === "running" || currentRun?.status === "cancelling" ? currentRun : undefined;
  const streamingRequestId = streamingRun?.requestId;
  const supersededFailureIds = useMemo(() => [...readSupersededFailureIds({ runs })].sort(), [runs]);
  const supersededFailures = useMemo(() => new Set(supersededFailureIds), [supersededFailureIds]);
  const deferredTerminalMessageId = readDeferredTerminalMessageId(streamingRun);
  const displayedMessages = useMemo(() => {
    const visible = messages.filter(
      (message) =>
        !(
          isSupersededFailure(message, supersededFailures) &&
          (historyHydrating || dismissedFailures.has(message.id))
        ) && message.id !== deferredTerminalMessageId,
    );
    // Preserve immutable source identity so revisiting an unchanged conversation
    // reuses its turn and stage projections instead of rebuilding the history.
    return visible.length === messages.length ? messages : visible;
  }, [deferredTerminalMessageId, dismissedFailures, historyHydrating, messages, supersededFailures]);
  const deferredMessages = useDeferredValue(displayedMessages);
  const deferredRuns = useDeferredValue(runs);
  const deferredStreamingRun = useDeferredValue(streamingRun);
  // The history projection may be deferred, but the active request must never
  // disappear between its streaming and terminal snapshots. Keep the latest
  // messages and run for that request in the deferred projection, including
  // the short hand-off frame after streamingRun becomes undefined.
  const activeRequestId = streamingRun?.requestId ?? deferredStreamingRun?.requestId;
  const projectedMessages = useMemo(() => {
    if (!activeRequestId || displayedMessages === deferredMessages) return deferredMessages;
    const knownIds = new Set(deferredMessages.map((message) => message.id));
    const activeMessages = displayedMessages.filter(
      (message) => message.requestId === activeRequestId && !knownIds.has(message.id),
    );
    return activeMessages.length > 0 ? [...deferredMessages, ...activeMessages] : deferredMessages;
  }, [activeRequestId, deferredMessages, displayedMessages]);
  const projectedRuns = useMemo(() => {
    // The active run is supplied independently to the conversation projection.
    // Do not rebuild a historical run list on every streamed frame merely to
    // replace that same item again below.
    if (streamingRun) return deferredRuns;
    if (!activeRequestId) return deferredRuns;
    const latestRun = runs.find((run) => run.requestId === activeRequestId) ?? streamingRun ?? deferredStreamingRun;
    if (!latestRun) return deferredRuns;
    const existingIndex = deferredRuns.findIndex((run) => run.requestId === activeRequestId);
    if (existingIndex < 0) return [...deferredRuns, latestRun];
    const nextRuns = [...deferredRuns];
    nextRuns[existingIndex] = latestRun;
    return nextRuns;
  }, [activeRequestId, deferredRuns, deferredStreamingRun, runs, streamingRun]);
  const items = useMemo(
    () => projectAssistantTurns(projectedMessages, projectedRuns, streamingRun),
    [projectedMessages, projectedRuns, streamingRun],
  );
  // Keep the socket/store path responsive while a large history projection is
  // being committed. React can paint the previous window first and reconcile
  // the new list at lower priority without changing the durable session state.
  const renderedItems = items;
  const eventRuns = useMemo(
    () => (streamingRequestId ? projectedRuns.filter((run) => run.requestId !== streamingRequestId) : projectedRuns),
    [projectedRuns, streamingRequestId],
  );
  const staticRunsByRequestId = useMemo(() => {
    const map = new Map<string, RunRecord>();
    for (const run of eventRuns) map.set(run.requestId, run);
    return map;
  }, [eventRuns]);
  // The rail follows durable conversation landmarks. Its own projection does
  // not include the live run, so thought and prose deltas cannot rebuild the
  // navigation source for the entire history.
  useEffect(() => {
    if (historyHydrating) {
      setEventRailReady(false);
      return;
    }
    return scheduleIdleTask(() => setEventRailReady(true), { priority: "user-visible" });
  }, [historyHydrating]);
  const shouldRenderEventRail = !historyHydrating && eventRailReady;
  const eventItems = useMemo(
    () =>
      shouldRenderEventRail ? projectAssistantTurns(projectedMessages, eventRuns, undefined, { scope: "event" }) : [],
    [eventRuns, projectedMessages, shouldRenderEventRail],
  );
  const itemKeys = useMemo(() => {
    return shouldRenderEventRail ? readProjectedMessageListItemKeys(renderedItems) : [];
  }, [renderedItems, shouldRenderEventRail]);
  const eventSourceItems = useMemo(() => {
    if (!shouldRenderEventRail) {
      eventSourceItemsRef.current = [];
      return [];
    }
    const next = eventItems.flatMap((item, index): ConversationEventSourceItem[] => {
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
      return sources;
    });
    const stable = retainEqualConversationEventSources(eventSourceItemsRef.current, next);
    eventSourceItemsRef.current = stable;
    return stable;
  }, [eventItems, shouldRenderEventRail]);
  const conversationEvents = useMemo(() => projectConversationEvents(eventSourceItems), [eventSourceItems]);
  const autoScroll = useVirtuosoAutoStickToBottom({
    itemCount: renderedItems.length,
    resetKey: sessionId,
    bottomThreshold: MESSAGE_LIST_BOTTOM_THRESHOLD,
  });
  const setAutoScrollScroller = autoScroll.scrollerRef;
  const beginManualScroll = autoScroll.beginManualScroll;
  const endManualScroll = autoScroll.endManualScroll;
  const requestDynamicHeightAutoscroll = autoScroll.requestDynamicHeightAutoscroll;
  const historyVirtualizerRef = autoScroll.ref;
  const scrollHistoryToBottom = autoScroll.scrollToBottom;
  const historyAnchorRef = useRef<{
    sessionId: string;
    key: string;
    offset: number;
    window?: AgentSessionHistoryWindow;
  } | null>(null);
  useLayoutEffect(() => {
    const scroller = chatScrollerRef.current;
    if (!scroller) return;
    if (historyAnchorRef.current?.sessionId !== sessionId) historyAnchorRef.current = null;
    if (historyLoading && !historyAnchorRef.current) {
      const top = scroller.getBoundingClientRect().top;
      const anchor = [...scroller.querySelectorAll<HTMLElement>(".chat-message-item[data-message-key]")].find(
        (element) => element.getBoundingClientRect().bottom > top,
      );
      if (anchor?.dataset.messageKey) {
        historyAnchorRef.current = {
          sessionId,
          key: anchor.dataset.messageKey,
          offset: anchor.getBoundingClientRect().top - top,
          window: historyWindow,
        };
        beginManualScroll();
      }
    }
    const anchor = historyAnchorRef.current;
    if (!anchor) return;
    const index = renderedItems.findIndex((item) => readMessageListItemKey(item) === anchor.key);
    if (index >= 0 && (historyLoading || historyWindow?.mode === "prepend")) {
      historyVirtualizerRef.current?.scrollIntoView({
        index,
        align: "start",
        behavior: "auto",
        calculateViewLocation: ({ locationParams }) => ({ ...locationParams, align: "start", offset: -anchor.offset }),
      });
    }
    if (!historyLoading) {
      historyAnchorRef.current = null;
      endManualScroll();
      if (historyWindow && historyWindow !== anchor.window && historyWindow.mode === "replace") scrollHistoryToBottom();
    }
  }, [
    historyVirtualizerRef,
    scrollHistoryToBottom,
    beginManualScroll,
    endManualScroll,
    historyLoading,
    historyWindow,
    renderedItems,
    sessionId,
  ]);

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
      const previousHeight = measuredHeightsRef.current.get(key) ?? null;
      if (previousHeight === height) return;
      measuredHeightsRef.current.set(key, height);
      if (shouldAutoscrollForListHeightChange(previousHeight, height)) {
        requestDynamicHeightAutoscroll();
      }
      scheduleEventHeightSnapshot();
    },
    [requestDynamicHeightAutoscroll, scheduleEventHeightSnapshot],
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
          const previousHeight = measuredHeightsRef.current.get(itemKey) ?? null;
          if (previousHeight !== size) {
            measuredHeightsRef.current.set(itemKey, size);
            // `itemSize` is Virtuoso's measurement path. It may run while the
            // virtualizer is reconciling its own layout, so it only refreshes
            // the cache here. The ResizeObserver path owns live-edge
            // scrolling after the browser has committed the new geometry.
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
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        data-chat-rail-mode={supportsHover && !prefersCompactControls ? "overlay" : "native"}
      >
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
            atTopStateChange={setIsAtTop}
            atTopThreshold={64}
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
                return (
                  <div
                    className="chat-message-item box-border w-full pb-5 pt-1"
                    data-message-key={itemKey}
                    ref={heightObserverRef}
                  >
                    <MotionMessageItem
                      motionKey={item.key}
                      // Assistant rows can transition from streaming to final
                      // in place. A mount transform here would move the whole
                      // conversation once the final token is committed.
                      animateOnMount={false}
                    >
                      <AssistantTurnRow
                        sessionId={sessionId}
                        turn={item}
                        assistantProfile={assistantProfile}
                        showInlineActions={showInlineMessageActions}
                        onForkFromMessage={onForkFromMessage}
                        onRegenerate={onRegenerate}
                        onDeleteFromMessage={setDeleting}
                        onViewWorkflow={onViewWorkflow}
                        onResolveInteractionInput={onResolveInteractionInput}
                        onRecordMessageFeedback={onRecordMessageFeedback}
                      />
                    </MotionMessageItem>
                  </div>
                );
              }
              const shouldAnimateMount = index >= renderedItems.length - 2;
              return (
                <div
                  className={`chat-message-item box-border w-full ${item.role === "system" ? "" : "pb-5 pt-1"}`}
                  data-message-key={itemKey}
                  ref={heightObserverRef}
                >
                  <MotionMessageItem motionKey={item.id} animateOnMount={shouldAnimateMount}>
                    <MessageRow
                      message={item}
                      run={
                        item.requestId === streamingRun?.requestId
                          ? streamingRun
                          : item.requestId
                            ? staticRunsByRequestId.get(item.requestId)
                            : undefined
                      }
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
                      assistantProfile={assistantProfile}
                      showInlineActions={showInlineMessageActions}
                      onFork={() => onForkFromMessage(item)}
                      onRegenerate={() => onRegenerate(item)}
                      onRetryRun={() => onRetryRun(item)}
                      onContinueRun={() => onContinueRun(item)}
                      failureSuperseded={isSupersededFailure(item, supersededFailures)}
                      onFailureDismissed={() => setDismissedFailures((previous) => new Set(previous).add(item.id))}
                      onDelete={() => setDeleting(item)}
                      onViewWorkflow={() => onViewWorkflow(item)}
                    />
                  </MotionMessageItem>
                </div>
              );
            }}
            components={messageListComponents}
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
        {historyWindow && onLoadHistory ? (
          <ChatHistoryNavigation
            sessionId={sessionId}
            window={historyWindow}
            atTop={isAtTop}
            loading={historyWindowLoading}
            failed={historyWindowFailed}
            disabled={historyWindowDisabled}
            onLoad={onLoadHistory}
          />
        ) : null}
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
});

const LazyMessageListVirtualizer = lazy(() =>
  import("./MessageListVirtualizer").then((module) => ({ default: module.MessageListVirtualizer })),
);

function MessageListVirtualizerLoadingState(): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-message-list-loading>
      <ChatLoadingSurface label={frontendMessage("ui.loading")} />
    </div>
  );
}

function readDeferredTerminalMessageId(run: RunRecord | undefined): string | undefined {
  return run?.displayMessageId &&
    run.outputState !== "available" &&
    run.outputState !== "committed" &&
    (run.visibleKind === "final_answer" || run.visibleKind === "ask_user")
    ? run.displayMessageId
    : undefined;
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

function readTurnEventProgress(messageIndex: number, messageCount: number, kind: ChatMessage["kind"]): number {
  if (kind === "AssistantFinal" || kind === "AssistantAsk" || kind === "Error") {
    // Keep multiple terminal landmarks inside one virtual row strictly ordered.
    return 0.7 + (0.24 * (messageIndex + 1)) / (messageCount + 1);
  }
  return (messageIndex + 1) / (messageCount + 1);
}

function retainEqualConversationEventSources(
  previous: readonly ConversationEventSourceItem[],
  next: readonly ConversationEventSourceItem[],
): readonly ConversationEventSourceItem[] {
  if (previous.length !== next.length) return next;
  for (let index = 0; index < next.length; index += 1) {
    const left = previous[index];
    const right = next[index];
    if (
      left?.key !== right?.key ||
      left?.requestId !== right?.requestId ||
      left?.eventKind !== right?.eventKind ||
      left?.content !== right?.content ||
      left?.itemIndex !== right?.itemIndex ||
      left?.itemProgress !== right?.itemProgress ||
      left?.anchorId !== right?.anchorId
    ) {
      return next;
    }
  }
  return previous;
}
