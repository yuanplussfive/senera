import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";

export type ConversationEventKind = "user_request" | "assistant_final" | "assistant_ask" | "assistant_error";

export interface ConversationEventSourceItem {
  key: string;
  requestId?: string;
  eventKind: ConversationEventKind | null;
  content: string;
  itemIndex?: number;
  itemProgress?: number;
  anchorId?: string;
}

export interface ConversationEventLandmark {
  id: string;
  requestId?: string;
  itemIndex: number;
  itemProgress: number;
  anchorId?: string;
  kind: ConversationEventKind;
  content: string;
}

interface ConversationEventMarker extends ConversationEventLandmark {
  position: number;
}

interface ConversationEventRailProps {
  events: readonly ConversationEventLandmark[];
  itemKeys: readonly string[];
  measuredHeights: ReadonlyMap<string, number>;
  defaultItemHeight: number;
  activeEventIndex: number;
  scroller: HTMLElement | null;
  onActiveEventChange: (index: number) => void;
  onNavigate: (event: ConversationEventLandmark) => void;
}

const EVENT_LABEL_KEYS = {
  user_request: "chat.eventRail.kind.userRequest",
  assistant_final: "chat.eventRail.kind.finalAnswer",
  assistant_ask: "chat.eventRail.kind.askUser",
  assistant_error: "chat.eventRail.kind.error",
} as const satisfies Record<ConversationEventKind, FrontendMessageKey>;

const PREVIEW_MAX_CHARACTERS = 180;
const EVENT_WINDOW_SIZE = 23;

export function ConversationEventRail({
  events,
  itemKeys,
  measuredHeights,
  defaultItemHeight,
  activeEventIndex,
  scroller,
  onActiveEventChange,
  onNavigate,
}: ConversationEventRailProps): JSX.Element | null {
  const previewId = useId();
  const scrollFrameRef = useRef<number | null>(null);
  const [hoveredEventIndex, setHoveredEventIndex] = useState<number | null>(null);
  const [scrollable, setScrollable] = useState(false);

  const markers = useMemo(
    () => projectConversationEventMarkers(events, itemKeys, measuredHeights, defaultItemHeight),
    [defaultItemHeight, events, itemKeys, measuredHeights],
  );

  const syncScrollMetrics = useCallback((): void => {
    if (!scroller) return;
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    setScrollable(maxScrollTop > 1);
    const readingPosition = Math.min(
      1,
      Math.max(0, (scroller.scrollTop + scroller.clientHeight * 0.28) / Math.max(1, scroller.scrollHeight)),
    );
    onActiveEventChange(readConversationEventPositionIndex(markers, readingPosition));
  }, [markers, onActiveEventChange, scroller]);

  const scheduleScrollMetricsSync = useCallback((): void => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      syncScrollMetrics();
    });
  }, [syncScrollMetrics]);

  useEffect(() => {
    if (!scroller) return;
    syncScrollMetrics();
    const resizeObserver = new ResizeObserver(scheduleScrollMetricsSync);
    resizeObserver.observe(scroller);
    scroller.addEventListener("scroll", scheduleScrollMetricsSync, { passive: true });
    return () => {
      resizeObserver.disconnect();
      scroller.removeEventListener("scroll", scheduleScrollMetricsSync);
    };
  }, [events.length, measuredHeights, scheduleScrollMetricsSync, scroller, syncScrollMetrics]);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    },
    [],
  );

  if (events.length === 0) return null;

  const visibleEvents = projectConversationEventWindow(events, activeEventIndex, EVENT_WINDOW_SIZE);

  const navigateToEvent = (eventIndex: number): void => {
    const event = events[eventIndex];
    if (!event) return;
    onActiveEventChange(eventIndex);
    onNavigate(event);
  };

  const navigateByKeyboard = (event: KeyboardEvent<HTMLElement>): void => {
    let nextIndex = activeEventIndex;
    if (event.key === "ArrowUp" || event.key === "PageUp" || event.key.toLowerCase() === "k") nextIndex -= 1;
    else if (event.key === "ArrowDown" || event.key === "PageDown" || event.key.toLowerCase() === "j") nextIndex += 1;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = markers.length - 1;
    else return;
    event.preventDefault();
    navigateToEvent(Math.min(markers.length - 1, Math.max(0, nextIndex)));
  };

  return (
    <nav
      className={cn("chat-event-rail", !scrollable && events.length < 2 && "chat-event-rail--idle")}
      aria-label={frontendMessage("chat.eventRail.ariaLabel")}
      data-chat-event-rail
      onKeyDown={navigateByKeyboard}
    >
      <button
        type="button"
        className="chat-event-rail__step chat-event-rail__step--previous"
        aria-label={frontendMessage("chat.eventRail.previous")}
        disabled={activeEventIndex <= 0}
        onClick={() => navigateToEvent(activeEventIndex - 1)}
      >
        <ChevronUp aria-hidden="true" />
      </button>

      <div className="chat-event-rail__events" data-chat-event-window>
        {visibleEvents.map(({ event, index }) => (
          <button
            key={event.id}
            type="button"
            className="chat-event-rail__event"
            data-kind={event.kind}
            data-active={index === activeEventIndex ? "true" : "false"}
            data-hovered={index === hoveredEventIndex ? "true" : "false"}
            aria-current={index === activeEventIndex ? "location" : undefined}
            aria-describedby={index === hoveredEventIndex ? previewId : undefined}
            aria-label={frontendMessage("chat.eventRail.jump", {
              index: index + 1,
              label: readConversationEventLabel(event.kind),
            })}
            onPointerEnter={() => setHoveredEventIndex(index)}
            onPointerLeave={() => setHoveredEventIndex(null)}
            onFocus={() => setHoveredEventIndex(index)}
            onBlur={() => setHoveredEventIndex(null)}
            onClick={() => navigateToEvent(index)}
          >
            <span className="chat-event-rail__tick" aria-hidden="true" />
            {index === hoveredEventIndex ? (
              <span id={previewId} className="chat-event-rail__preview" role="tooltip" data-chat-event-preview>
                <span className="chat-event-rail__preview-meta">{readConversationEventSpeaker(event.kind)}</span>
                {event.content ? <span className="chat-event-rail__preview-body">{event.content}</span> : null}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="chat-event-rail__step chat-event-rail__step--next"
        aria-label={frontendMessage("chat.eventRail.next")}
        disabled={activeEventIndex >= events.length - 1}
        onClick={() => navigateToEvent(activeEventIndex + 1)}
      >
        <ChevronDown aria-hidden="true" />
      </button>
      <span className="sr-only">
        {frontendMessage("chat.eventRail.current", {
          current: activeEventIndex + 1,
          total: events.length,
          label: readConversationEventLabel(events[Math.min(activeEventIndex, events.length - 1)]!.kind),
        })}
      </span>
    </nav>
  );
}

export function projectConversationEventWindow<T>(
  events: readonly T[],
  activeEventIndex: number,
  windowSize = EVENT_WINDOW_SIZE,
): Array<{ event: T; index: number }> {
  if (events.length === 0 || windowSize <= 0) return [];
  const visibleCount = Math.min(events.length, Math.max(1, Math.floor(windowSize)));
  const safeActiveIndex = Math.min(events.length - 1, Math.max(0, activeEventIndex));
  const preferredStart = safeActiveIndex - Math.floor(visibleCount / 2);
  const start = Math.min(events.length - visibleCount, Math.max(0, preferredStart));
  return events.slice(start, start + visibleCount).map((event, offset) => ({
    event,
    index: start + offset,
  }));
}

export function projectConversationEvents(items: readonly ConversationEventSourceItem[]): ConversationEventLandmark[] {
  const events: ConversationEventLandmark[] = [];

  items.forEach((item, sourceIndex) => {
    if (item.eventKind === null) return;

    events.push({
      id: `event:${item.key}:${item.eventKind}`,
      requestId: item.requestId,
      itemIndex: item.itemIndex ?? sourceIndex,
      itemProgress: Math.min(1, Math.max(0, item.itemProgress ?? 0)),
      anchorId: item.anchorId,
      kind: item.eventKind,
      content: compactPreview(item.content),
    });
  });

  return events;
}

export function projectConversationEventMarkers(
  events: readonly ConversationEventLandmark[],
  itemKeys: readonly string[],
  measuredHeights: ReadonlyMap<string, number>,
  defaultItemHeight: number,
): ConversationEventMarker[] {
  if (events.length === 0) return [];
  const offsets = [0];
  for (const key of itemKeys) {
    offsets.push(offsets[offsets.length - 1]! + (measuredHeights.get(key) ?? defaultItemHeight));
  }
  const totalHeight = Math.max(1, offsets[offsets.length - 1] ?? 1);
  return events.map((event) => {
    const itemStart = offsets[event.itemIndex] ?? 0;
    const itemHeight = measuredHeights.get(itemKeys[event.itemIndex] ?? "") ?? defaultItemHeight;
    return {
      ...event,
      position: Math.min(1, Math.max(0, (itemStart + itemHeight * event.itemProgress) / totalHeight)),
    };
  });
}

export function readConversationEventIndex(events: readonly ConversationEventLandmark[], itemIndex: number): number {
  if (events.length === 0) return 0;
  let previousIndex = 0;
  for (let index = 0; index < events.length; index += 1) {
    const eventItemIndex = events[index]!.itemIndex;
    if (eventItemIndex === itemIndex) return index;
    if (eventItemIndex > itemIndex) return previousIndex;
    previousIndex = index;
  }
  return previousIndex;
}

export function readConversationEventPositionIndex(
  events: readonly Pick<ConversationEventMarker, "position">[],
  position: number,
): number {
  if (events.length === 0) return 0;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]!.position <= position) return index;
  }
  return 0;
}

function readConversationEventLabel(kind: ConversationEventKind): string {
  return frontendMessage(EVENT_LABEL_KEYS[kind]);
}

function readConversationEventSpeaker(kind: ConversationEventKind): string {
  return frontendMessage(kind === "user_request" ? "chat.eventRail.speaker.user" : "chat.eventRail.speaker.assistant");
}

function compactPreview(value: string): string {
  const compact = value
    .replace(/^```[^\n]*$/gmu, "")
    .replace(/^\s*(?:#{1,6}|>|[-*+])\s+/gmu, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/[*_~]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (compact.length <= PREVIEW_MAX_CHARACTERS) return compact;
  return `${compact.slice(0, PREVIEW_MAX_CHARACTERS - 1)}…`;
}

export default ConversationEventRail;
