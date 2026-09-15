import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { VirtuosoHandle } from "react-virtuoso";

const SCROLL_AWAY_KEYS = new Set<KeyboardEvent["key"]>(["ArrowUp", "PageUp", "Home"]);
const SCROLL_TOWARD_BOTTOM_KEYS = new Set<KeyboardEvent["key"]>(["ArrowDown", "PageDown", "End"]);
const SCROLLBAR_HIT_SLOP_PX = 24;
const USER_SCROLL_UP_EPSILON_PX = 2;
// react-virtuoso keeps a 100 ms size-increase observer for each autoscroll request.
// Keep only one request alive while a streamed row settles through several measurements.
const DYNAMIC_HEIGHT_AUTOSCROLL_COOLDOWN_MS = 180;
type VirtuosoScrollBehavior = "auto" | "smooth";
type ScheduledScroll = {
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

export function resolveVirtuosoFollowOutput(shouldStickToBottom: boolean): "auto" | false {
  return shouldStickToBottom ? "auto" : false;
}

export function shouldRequestDynamicHeightAutoscroll({
  shouldStickToBottom,
  hasPendingRequest,
}: {
  shouldStickToBottom: boolean;
  hasPendingRequest: boolean;
}): boolean {
  return shouldStickToBottom && !hasPendingRequest;
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
  ref: RefObject<VirtuosoHandle | null>;
  scrollerRef: (ref: HTMLElement | Window | null) => void;
  followOutput: (isAtBottom: boolean) => "auto" | false;
  atBottomStateChange: (atBottom: boolean) => void;
  totalListHeightChanged: (height: number) => void;
  scrollToBottom: (behavior?: VirtuosoScrollBehavior) => void;
  beginManualScroll: () => void;
  endManualScroll: () => void;
} {
  const ref = useRef<VirtuosoHandle>(null);
  const itemCountRef = useRef(itemCount);
  const stickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const lastPointerYRef = useRef<number | null>(null);
  const lastTouchYRef = useRef<number | null>(null);
  const userScrollAwayIntentRef = useRef(false);
  const userScrollTowardBottomIntentRef = useRef(false);
  const scrollbarDragRef = useRef(false);
  const scrollerTargetRef = useRef<HTMLElement | Window | null>(null);
  const frameRef = useRef<number | null>(null);
  const scheduledScrollRef = useRef<ScheduledScroll | null>(null);
  const dynamicHeightAutoscrollFrameRef = useRef<number | null>(null);
  const dynamicHeightAutoscrollCooldownRef = useRef<number | null>(null);
  const [scroller, setScroller] = useState<HTMLElement | Window | null>(null);
  itemCountRef.current = itemCount;

  const cancelPendingScroll = useCallback(() => {
    if (frameRef.current === null) return;
    window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    scheduledScrollRef.current = null;
  }, []);

  const clearDynamicHeightAutoscrollCooldown = useCallback((): void => {
    if (dynamicHeightAutoscrollFrameRef.current !== null) {
      window.cancelAnimationFrame(dynamicHeightAutoscrollFrameRef.current);
      dynamicHeightAutoscrollFrameRef.current = null;
    }
    if (dynamicHeightAutoscrollCooldownRef.current === null) return;
    window.clearTimeout(dynamicHeightAutoscrollCooldownRef.current);
    dynamicHeightAutoscrollCooldownRef.current = null;
  }, []);

  const requestDynamicHeightAutoscroll = useCallback((): void => {
    if (
      !shouldRequestDynamicHeightAutoscroll({
        shouldStickToBottom: stickToBottomRef.current,
        hasPendingRequest:
          dynamicHeightAutoscrollFrameRef.current !== null || dynamicHeightAutoscrollCooldownRef.current !== null,
      })
    ) {
      return;
    }

    dynamicHeightAutoscrollFrameRef.current = window.requestAnimationFrame(() => {
      dynamicHeightAutoscrollFrameRef.current = null;
      if (!stickToBottomRef.current) return;
      ref.current?.autoscrollToBottom();
      dynamicHeightAutoscrollCooldownRef.current = window.setTimeout(() => {
        dynamicHeightAutoscrollCooldownRef.current = null;
      }, DYNAMIC_HEIGHT_AUTOSCROLL_COOLDOWN_MS);
    });
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

  const beginManualScroll = useCallback((): void => {
    scrollbarDragRef.current = true;
    markScrollAwayIntent();
  }, [markScrollAwayIntent]);

  const resumeStickToBottom = useCallback((): void => {
    stickToBottomRef.current = true;
    userScrollAwayIntentRef.current = false;
    userScrollTowardBottomIntentRef.current = false;
  }, []);

  const syncScrollPosition = useCallback((target = scrollerTargetRef.current): void => {
    if (!target) return;
    lastScrollTopRef.current = readScrollMetrics(target).scrollTop;
  }, []);

  const endManualScroll = useCallback((): void => {
    scrollbarDragRef.current = false;
    lastPointerYRef.current = null;
    const target = scrollerTargetRef.current;
    if (!target) return;
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
  }, [bottomThreshold, resumeStickToBottom]);

  const scheduleScroll = useCallback(
    (request: ScheduledScroll): void => {
      scheduledScrollRef.current = mergeScheduledScroll(scheduledScrollRef.current, request);
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const scheduled = scheduledScrollRef.current;
        scheduledScrollRef.current = null;
        if (!scheduled) return;

        const nextItemCount = itemCountRef.current;
        if (nextItemCount > 0) {
          ref.current?.scrollToIndex({
            index: nextItemCount - 1,
            align: "end",
            behavior: scheduled.behavior,
          });
        }
        syncScrollPosition();
      });
    },
    [syncScrollPosition],
  );

  const scrollToBottom = useCallback(
    (behavior: VirtuosoScrollBehavior = "auto") => {
      if (itemCountRef.current <= 0) return;
      scheduleScroll({ behavior });
    },
    [scheduleScroll],
  );

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
        beginManualScroll();
        lastPointerYRef.current = event.clientY;
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
      endManualScroll();
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
    beginManualScroll,
    handleScrollerScroll,
    endManualScroll,
    markScrollAwayIntent,
    markScrollTowardBottomIntent,
    resumeStickToBottom,
    scroller,
  ]);

  useEffect(() => {
    clearDynamicHeightAutoscrollCooldown();
    resumeStickToBottom();
    scrollToBottom();
  }, [clearDynamicHeightAutoscrollCooldown, resetKey, resumeStickToBottom, scrollToBottom]);

  const followOutput = useCallback(
    (_isAtBottom: boolean): "auto" | false => resolveVirtuosoFollowOutput(stickToBottomRef.current),
    [],
  );

  useEffect(
    () => () => {
      cancelPendingScroll();
      clearDynamicHeightAutoscrollCooldown();
    },
    [cancelPendingScroll, clearDynamicHeightAutoscrollCooldown],
  );

  return {
    ref,
    scrollerRef,
    followOutput,
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
    totalListHeightChanged: () => {
      requestDynamicHeightAutoscroll();
    },
    scrollToBottom: scrollToBottomAndResume,
    beginManualScroll,
    endManualScroll,
  };
}

export function mergeScheduledScroll(current: ScheduledScroll | null, incoming: ScheduledScroll): ScheduledScroll {
  if (!current) return incoming;
  return {
    behavior: current.behavior === "smooth" || incoming.behavior === "smooth" ? "smooth" : "auto",
  };
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
