import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { VirtuosoHandle } from "react-virtuoso";

const SCROLL_AWAY_KEYS = new Set<KeyboardEvent["key"]>(["ArrowUp", "PageUp", "Home"]);

export function useVirtuosoAutoStickToBottom({
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
