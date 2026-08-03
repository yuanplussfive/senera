import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { VirtuosoHandle } from "react-virtuoso";

const SCROLL_AWAY_KEYS = new Set<KeyboardEvent["key"]>(["ArrowUp", "PageUp", "Home"]);
const SCROLL_TOWARD_BOTTOM_KEYS = new Set<KeyboardEvent["key"]>(["ArrowDown", "PageDown", "End"]);
const SCROLLBAR_HIT_SLOP_PX = 24;
const USER_SCROLL_UP_EPSILON_PX = 2;
type VirtuosoScrollBehavior = "auto" | "smooth";
type ScheduledScroll = {
  kind: "align-bottom" | "last-item";
  behavior: VirtuosoScrollBehavior;
};

export function shouldResumeAutoStickToBottom({
  atBottom,
  hasScrollAwayIntent,
  hasScrollTowardBottomIntent,
  isScrollbarDragging,
}: {
  atBottom: boolean;
  hasScrollAwayIntent: boolean;
  hasScrollTowardBottomIntent: boolean;
  isScrollbarDragging: boolean;
}): boolean {
  return atBottom && !isScrollbarDragging && (!hasScrollAwayIntent || hasScrollTowardBottomIntent);
}

export function useVirtuosoAutoStickToBottom({
  itemCount,
  resetKey,
  bottomThreshold,
}: {
  itemCount: number;
  resetKey: string;
  bottomThreshold: number;
}): {
  ref: RefObject<VirtuosoHandle>;
  scrollerRef: (ref: HTMLElement | Window | null) => void;
  followOutput: false;
  atBottomStateChange: (atBottom: boolean) => void;
  totalListHeightChanged: (height: number) => void;
  scrollToBottom: (behavior?: VirtuosoScrollBehavior) => void;
} {
  const ref = useRef<VirtuosoHandle>(null);
  const itemCountRef = useRef(itemCount);
  const stickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const lastListHeightRef = useRef(0);
  const lastPointerYRef = useRef<number | null>(null);
  const lastTouchYRef = useRef<number | null>(null);
  const userScrollAwayIntentRef = useRef(false);
  const userScrollTowardBottomIntentRef = useRef(false);
  const scrollbarDragRef = useRef(false);
  const scrollerTargetRef = useRef<HTMLElement | Window | null>(null);
  const frameRef = useRef<number | null>(null);
  const scheduledScrollRef = useRef<ScheduledScroll | null>(null);
  const previousItemCountRef = useRef(itemCount);
  const [scroller, setScroller] = useState<HTMLElement | Window | null>(null);
  itemCountRef.current = itemCount;

  const cancelPendingScroll = useCallback(() => {
    if (frameRef.current === null) return;
    window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    scheduledScrollRef.current = null;
  }, []);

  const markScrollAwayIntent = useCallback((): void => {
    userScrollAwayIntentRef.current = true;
    userScrollTowardBottomIntentRef.current = false;
    stickToBottomRef.current = false;
    cancelPendingScroll();
  }, [cancelPendingScroll]);

  const markScrollTowardBottomIntent = useCallback((): void => {
    userScrollTowardBottomIntentRef.current = true;
  }, []);

  const resumeStickToBottom = useCallback((): void => {
    stickToBottomRef.current = true;
    userScrollAwayIntentRef.current = false;
    userScrollTowardBottomIntentRef.current = false;
  }, []);

  const syncScrollPosition = useCallback((target = scrollerTargetRef.current): void => {
    if (!target) return;
    lastScrollTopRef.current = readScrollMetrics(target).scrollTop;
  }, []);

  const scheduleScroll = useCallback(
    (request: ScheduledScroll): void => {
      scheduledScrollRef.current = mergeScheduledScroll(scheduledScrollRef.current, request);
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const scheduled = scheduledScrollRef.current;
        scheduledScrollRef.current = null;
        if (!scheduled) return;

        if (scheduled.kind === "last-item") {
          const nextItemCount = itemCountRef.current;
          if (nextItemCount > 0) {
            ref.current?.scrollToIndex({
              index: nextItemCount - 1,
              align: "end",
              behavior: scheduled.behavior,
            });
          }
        } else {
          alignScrollTargetToBottom(scrollerTargetRef.current);
        }
        syncScrollPosition();
      });
    },
    [syncScrollPosition],
  );

  const scrollToBottom = useCallback(
    (behavior: VirtuosoScrollBehavior = "auto") => {
      if (itemCountRef.current <= 0) return;
      scheduleScroll({ kind: "last-item", behavior });
    },
    [scheduleScroll],
  );

  const alignToBottom = useCallback((): void => {
    scheduleScroll({ kind: "align-bottom", behavior: "auto" });
  }, [scheduleScroll]);

  const scrollToBottomAndResume = useCallback(
    (behavior: VirtuosoScrollBehavior = "auto") => {
      resumeStickToBottom();
      scrollToBottom(behavior);
    },
    [resumeStickToBottom, scrollToBottom],
  );

  const rememberScrollPosition = useCallback(
    (target: HTMLElement | Window): void => {
      syncScrollPosition(target);
    },
    [syncScrollPosition],
  );

  const scrollerRef = useCallback(
    (target: HTMLElement | Window | null): void => {
      if (scrollerTargetRef.current === target) return; // Prevent redundant setState calls
      scrollerTargetRef.current = target;
      setScroller(target);
      if (target) rememberScrollPosition(target);
    },
    [rememberScrollPosition],
  );

  const handleScrollerScroll = useCallback(() => {
    if (!scroller) return;
    const metrics = readScrollMetrics(scroller);
    const previousScrollTop = lastScrollTopRef.current;
    const movedTowardTop = metrics.scrollTop < previousScrollTop - USER_SCROLL_UP_EPSILON_PX;
    const movedTowardBottom = metrics.scrollTop > previousScrollTop + USER_SCROLL_UP_EPSILON_PX;
    lastScrollTopRef.current = metrics.scrollTop;

    if (movedTowardTop && scrollbarDragRef.current) markScrollAwayIntent();
    if (movedTowardBottom && scrollbarDragRef.current) markScrollTowardBottomIntent();

    if (metrics.distanceToBottom <= bottomThreshold) {
      if (
        shouldResumeAutoStickToBottom({
          atBottom: true,
          hasScrollAwayIntent: userScrollAwayIntentRef.current,
          hasScrollTowardBottomIntent: userScrollTowardBottomIntentRef.current,
          isScrollbarDragging: scrollbarDragRef.current,
        })
      ) {
        resumeStickToBottom();
      }
      return;
    }

    if (userScrollAwayIntentRef.current || scrollbarDragRef.current) {
      stickToBottomRef.current = false;
      cancelPendingScroll();
    }
  }, [
    bottomThreshold,
    cancelPendingScroll,
    markScrollAwayIntent,
    markScrollTowardBottomIntent,
    resumeStickToBottom,
    scroller,
  ]);

  useEffect(() => {
    if (!scroller) return;
    const target = scroller;
    const handleWheel: EventListener = (event): void => {
      if (!(event instanceof WheelEvent)) return;
      if (event.deltaY < 0) markScrollAwayIntent();
      if (event.deltaY > 0) markScrollTowardBottomIntent();
    };
    const handlePointerDown: EventListener = (event): void => {
      if (event instanceof PointerEvent && isPointerInVerticalScrollbar(event, target)) {
        scrollbarDragRef.current = true;
        lastPointerYRef.current = event.clientY;
        markScrollAwayIntent();
      }
    };
    const handlePointerMove = (event: PointerEvent): void => {
      if (!scrollbarDragRef.current) return;
      const lastY = lastPointerYRef.current;
      lastPointerYRef.current = event.clientY;
      if (lastY === null) return;
      if (event.clientY < lastY - USER_SCROLL_UP_EPSILON_PX) markScrollAwayIntent();
      if (event.clientY > lastY + USER_SCROLL_UP_EPSILON_PX) markScrollTowardBottomIntent();
    };
    const handlePointerRelease = (): void => {
      scrollbarDragRef.current = false;
      lastPointerYRef.current = null;
      const metrics = readScrollMetrics(target);
      if (
        shouldResumeAutoStickToBottom({
          atBottom: metrics.distanceToBottom <= bottomThreshold,
          hasScrollAwayIntent: userScrollAwayIntentRef.current,
          hasScrollTowardBottomIntent: userScrollTowardBottomIntentRef.current,
          isScrollbarDragging: false,
        })
      ) {
        resumeStickToBottom();
      }
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
      if (currentY != null && lastY != null && currentY < lastY) markScrollTowardBottomIntent();
    };
    const handleKeyDown: EventListener = (event): void => {
      if (!(event instanceof KeyboardEvent)) return;
      if (isScrollAwayKey(event)) markScrollAwayIntent();
      if (isScrollTowardBottomKey(event)) markScrollTowardBottomIntent();
    };

    scroller.addEventListener("scroll", handleScrollerScroll, { passive: true });
    target.addEventListener("pointerdown", handlePointerDown, { passive: true });
    target.addEventListener("wheel", handleWheel, { passive: true });
    target.addEventListener("touchstart", handleTouchStart, { passive: true });
    target.addEventListener("touchmove", handleTouchMove, { passive: true });
    target.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerRelease);
    window.addEventListener("pointercancel", handlePointerRelease);

    return () => {
      scroller.removeEventListener("scroll", handleScrollerScroll);
      target.removeEventListener("pointerdown", handlePointerDown);
      target.removeEventListener("wheel", handleWheel);
      target.removeEventListener("touchstart", handleTouchStart);
      target.removeEventListener("touchmove", handleTouchMove);
      target.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerRelease);
      window.removeEventListener("pointercancel", handlePointerRelease);
    };
  }, [
    bottomThreshold,
    handleScrollerScroll,
    markScrollAwayIntent,
    markScrollTowardBottomIntent,
    resumeStickToBottom,
    scroller,
  ]);

  useEffect(() => {
    resumeStickToBottom();
    lastListHeightRef.current = 0;
    previousItemCountRef.current = itemCountRef.current;
    scrollToBottom();
  }, [resetKey, resumeStickToBottom, scrollToBottom]);

  useEffect(() => {
    const changed = previousItemCountRef.current !== itemCount;
    previousItemCountRef.current = itemCount;
    if (changed && stickToBottomRef.current) scrollToBottom();
  }, [itemCount, scrollToBottom]);

  useEffect(() => cancelPendingScroll, [cancelPendingScroll]);

  return {
    ref,
    scrollerRef,
    followOutput: false,
    atBottomStateChange: (atBottom) => {
      if (
        shouldResumeAutoStickToBottom({
          atBottom,
          hasScrollAwayIntent: userScrollAwayIntentRef.current,
          hasScrollTowardBottomIntent: userScrollTowardBottomIntentRef.current,
          isScrollbarDragging: scrollbarDragRef.current,
        })
      ) {
        resumeStickToBottom();
      }
    },
    totalListHeightChanged: (height) => {
      if (height === lastListHeightRef.current) return;
      lastListHeightRef.current = height;
      if (stickToBottomRef.current) alignToBottom();
    },
    scrollToBottom: scrollToBottomAndResume,
  };
}

export function mergeScheduledScroll(current: ScheduledScroll | null, incoming: ScheduledScroll): ScheduledScroll {
  if (!current) return incoming;
  if (current.kind === "last-item" && incoming.kind === "align-bottom") return current;
  if (current.kind === "align-bottom" && incoming.kind === "last-item") return incoming;
  return {
    kind: current.kind,
    behavior: current.behavior === "smooth" || incoming.behavior === "smooth" ? "smooth" : "auto",
  };
}

function alignScrollTargetToBottom(target: HTMLElement | Window | null): void {
  if (!target) return;
  const element =
    target instanceof Window ? (target.document.scrollingElement ?? target.document.documentElement) : target;
  const viewportHeight = target instanceof Window ? target.innerHeight : element.clientHeight;
  const scrollTop = Math.max(0, element.scrollHeight - viewportHeight);
  if (target instanceof Window) {
    target.scrollTo({ top: scrollTop, behavior: "auto" });
    return;
  }
  target.scrollTop = scrollTop;
}

function readScrollMetrics(target: HTMLElement | Window): {
  scrollTop: number;
  scrollHeight: number;
  viewportHeight: number;
  distanceToBottom: number;
} {
  const element =
    target instanceof Window ? (target.document.scrollingElement ?? target.document.documentElement) : target;
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

function isPointerInVerticalScrollbar(event: PointerEvent, target: HTMLElement | Window): boolean {
  if (target instanceof Window) return false;
  if (target.scrollHeight <= target.clientHeight) return false;
  const rect = target.getBoundingClientRect();
  const scrollbarWidth = Math.max(SCROLLBAR_HIT_SLOP_PX, target.offsetWidth - target.clientWidth);
  return (
    event.clientX >= rect.right - scrollbarWidth &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
}

function isScrollAwayKey(event: KeyboardEvent): boolean {
  return SCROLL_AWAY_KEYS.has(event.key) || (event.shiftKey && event.key === " ");
}

function isScrollTowardBottomKey(event: KeyboardEvent): boolean {
  return SCROLL_TOWARD_BOTTOM_KEYS.has(event.key) || (!event.shiftKey && event.key === " ");
}
