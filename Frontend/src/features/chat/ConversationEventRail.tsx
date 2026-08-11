import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";

export type ConversationEventKind =
  "user_request" | "assistant_tool_preface" | "assistant_final" | "assistant_ask" | "assistant_error";

export interface ConversationEventSourceItem {
  key: string;
  requestId?: string;
  eventKind: ConversationEventKind | null;
  content: string;
}

export interface ConversationEventLandmark {
  id: string;
  requestId?: string;
  itemIndex: number;
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
  reducedMotion: boolean;
  onActiveEventChange: (index: number) => void;
  onNavigate: (event: ConversationEventLandmark) => void;
  onManualScrollStart: () => void;
  onManualScrollEnd: () => void;
}

const EVENT_LABEL_KEYS = {
  user_request: "chat.eventRail.kind.userRequest",
  assistant_tool_preface: "chat.eventRail.kind.toolPreface",
  assistant_final: "chat.eventRail.kind.finalAnswer",
  assistant_ask: "chat.eventRail.kind.askUser",
  assistant_error: "chat.eventRail.kind.error",
} as const satisfies Record<ConversationEventKind, FrontendMessageKey>;

const PREVIEW_MAX_CHARACTERS = 180;
const POINTER_CLICK_TOLERANCE_PX = 4;

export function ConversationEventRail({
  events,
  itemKeys,
  measuredHeights,
  defaultItemHeight,
  activeEventIndex,
  scroller,
  reducedMotion,
  onActiveEventChange,
  onNavigate,
  onManualScrollStart,
  onManualScrollEnd,
}: ConversationEventRailProps): JSX.Element | null {
  const railRef = useRef<HTMLDivElement>(null);
  const previewId = useId();
  const pointerStateRef = useRef<{
    pointerId: number;
    startY: number;
    moved: boolean;
    eventIndex: number;
  } | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const [scrollProgress, setScrollProgress] = useState(1);
  const [hoveredEventIndex, setHoveredEventIndex] = useState<number | null>(null);
  const [hoverY, setHoverY] = useState(0);
  const [scrollable, setScrollable] = useState(false);

  const markers = useMemo(
    () => projectConversationEventMarkers(events, itemKeys, measuredHeights, defaultItemHeight),
    [defaultItemHeight, events, itemKeys, measuredHeights],
  );

  const syncScrollMetrics = useCallback((): void => {
    if (!scroller) return;
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    setScrollable(maxScrollTop > 1);
    setScrollProgress(maxScrollTop > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / maxScrollTop)) : 0);
  }, [scroller]);

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

  const hoveredEvent = hoveredEventIndex === null ? undefined : markers[hoveredEventIndex];
  const currentEvent = markers[Math.min(activeEventIndex, markers.length - 1)];

  const updateHover = (clientY: number): number | null => {
    const point = readRailPoint(railRef.current, clientY);
    if (!point) return null;
    const eventIndex = findNearestMarkerIndex(markers, point.ratio);
    setHoverY(point.y);
    setHoveredEventIndex(eventIndex);
    return eventIndex;
  };

  const scrollFromPointer = (clientY: number): void => {
    if (!scroller) return;
    const point = readRailPoint(railRef.current, clientY);
    if (!point) return;
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTo({ top: maxScrollTop * point.ratio, behavior: "auto" });
  };

  const endPointerInteraction = (event: PointerEvent<HTMLDivElement>): void => {
    const pointerState = pointerStateRef.current;
    if (!pointerState || pointerState.pointerId !== event.pointerId) return;
    pointerStateRef.current = null;
    if (railRef.current?.hasPointerCapture(event.pointerId)) railRef.current.releasePointerCapture(event.pointerId);
    onManualScrollEnd();
    if (!pointerState.moved) navigateToEvent(pointerState.eventIndex);
  };

  const navigateToEvent = (eventIndex: number): void => {
    const event = events[eventIndex];
    if (!event) return;
    onActiveEventChange(eventIndex);
    onNavigate(event);
  };

  const navigateByKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    let nextIndex = activeEventIndex;
    if (event.key === "ArrowUp" || event.key === "PageUp") nextIndex -= 1;
    else if (event.key === "ArrowDown" || event.key === "PageDown") nextIndex += 1;
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
    >
      <div
        ref={railRef}
        className="chat-event-rail__track"
        role="scrollbar"
        tabIndex={0}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(scrollProgress * 100)}
        aria-valuetext={
          currentEvent
            ? frontendMessage("chat.eventRail.current", {
                current: activeEventIndex + 1,
                total: markers.length,
                label: readConversationEventLabel(currentEvent.kind),
              })
            : undefined
        }
        onKeyDown={navigateByKeyboard}
        onPointerEnter={(event) => updateHover(event.clientY)}
        onPointerLeave={() => {
          if (!pointerStateRef.current) setHoveredEventIndex(null);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || !scroller) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const eventIndex = updateHover(event.clientY) ?? activeEventIndex;
          pointerStateRef.current = {
            pointerId: event.pointerId,
            startY: event.clientY,
            moved: false,
            eventIndex,
          };
          onManualScrollStart();
          scrollFromPointer(event.clientY);
        }}
        onPointerMove={(event) => {
          const eventIndex = updateHover(event.clientY);
          const pointerState = pointerStateRef.current;
          if (!pointerState || pointerState.pointerId !== event.pointerId) return;
          if (Math.abs(event.clientY - pointerState.startY) >= POINTER_CLICK_TOLERANCE_PX) pointerState.moved = true;
          if (eventIndex !== null) pointerState.eventIndex = eventIndex;
          scrollFromPointer(event.clientY);
        }}
        onPointerUp={endPointerInteraction}
        onPointerCancel={endPointerInteraction}
      >
        <span className="chat-event-rail__ruler" aria-hidden="true" />
        <span
          className="chat-event-rail__thumb"
          style={{ top: `${scrollProgress * 100}%` }}
          data-reduced-motion={reducedMotion ? "true" : "false"}
          aria-hidden="true"
        />
      </div>

      {markers.map((event, index) => (
        <button
          key={event.id}
          type="button"
          className="chat-event-rail__event"
          style={{ top: `${event.position * 100}%` }}
          data-kind={event.kind}
          data-active={index === activeEventIndex ? "true" : "false"}
          data-hovered={index === hoveredEventIndex ? "true" : "false"}
          aria-current={index === activeEventIndex ? "location" : undefined}
          aria-describedby={index === hoveredEventIndex ? previewId : undefined}
          aria-label={frontendMessage("chat.eventRail.jump", {
            index: index + 1,
            label: readConversationEventLabel(event.kind),
          })}
          onPointerEnter={() => {
            setHoveredEventIndex(index);
            setHoverY(event.position * (railRef.current?.clientHeight ?? 0));
          }}
          onPointerLeave={() => setHoveredEventIndex(null)}
          onFocus={() => {
            setHoveredEventIndex(index);
            setHoverY(event.position * (railRef.current?.clientHeight ?? 0));
          }}
          onBlur={() => setHoveredEventIndex(null)}
          onClick={() => navigateToEvent(index)}
        />
      ))}

      {hoveredEvent ? (
        <div
          id={previewId}
          className="chat-event-rail__preview"
          style={{ top: `clamp(68px, ${hoverY}px, calc(100% - 68px))` }}
          role="tooltip"
          data-chat-event-preview
        >
          <div className="chat-event-rail__preview-meta">
            {frontendMessage("chat.eventRail.event", {
              index: hoveredEventIndex! + 1,
              total: markers.length,
            })}
          </div>
          <div className="chat-event-rail__preview-title">{readConversationEventLabel(hoveredEvent.kind)}</div>
          {hoveredEvent.content ? <div className="chat-event-rail__preview-body">{hoveredEvent.content}</div> : null}
        </div>
      ) : null}
    </nav>
  );
}

export function projectConversationEvents(items: readonly ConversationEventSourceItem[]): ConversationEventLandmark[] {
  const events: ConversationEventLandmark[] = [];
  const toolPrefaceScopes = new Set<string>();
  let fallbackRequestScope = "conversation-start";

  items.forEach((item, itemIndex) => {
    if (item.eventKind === "user_request") fallbackRequestScope = `user:${item.key}`;
    if (item.eventKind === null) return;

    if (item.eventKind === "assistant_tool_preface") {
      const scope = item.requestId ? `request:${item.requestId}` : fallbackRequestScope;
      if (toolPrefaceScopes.has(scope)) return;
      toolPrefaceScopes.add(scope);
    }

    events.push({
      id: `event:${item.key}:${item.eventKind}`,
      requestId: item.requestId,
      itemIndex,
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
  return events.map((event) => ({
    ...event,
    position: Math.min(1, Math.max(0, (offsets[event.itemIndex] ?? 0) / totalHeight)),
  }));
}

export function readConversationEventIndex(events: readonly ConversationEventLandmark[], itemIndex: number): number {
  if (events.length === 0) return 0;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]!.itemIndex <= itemIndex) return index;
  }
  return 0;
}

function readConversationEventLabel(kind: ConversationEventKind): string {
  return frontendMessage(EVENT_LABEL_KEYS[kind]);
}

function readRailPoint(element: HTMLElement | null, clientY: number): { y: number; ratio: number } | undefined {
  if (!element) return undefined;
  const rect = element.getBoundingClientRect();
  const y = Math.min(rect.height, Math.max(0, clientY - rect.top));
  return { y, ratio: rect.height > 0 ? y / rect.height : 0 };
}

function findNearestMarkerIndex(markers: readonly ConversationEventMarker[], ratio: number): number {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  markers.forEach((marker, index) => {
    const distance = Math.abs(marker.position - ratio);
    if (distance >= nearestDistance) return;
    nearestDistance = distance;
    nearestIndex = index;
  });
  return nearestIndex;
}

function compactPreview(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= PREVIEW_MAX_CHARACTERS) return compact;
  return `${compact.slice(0, PREVIEW_MAX_CHARACTERS - 1)}…`;
}

export default ConversationEventRail;
