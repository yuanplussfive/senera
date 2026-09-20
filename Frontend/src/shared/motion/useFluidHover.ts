import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import { useMotionLevel } from "./MotionLevelContext";

export interface FluidHoverItemRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type FluidHoverAxis = "x" | "y" | "xy";

export interface UseFluidHoverOptions {
  axis?: FluidHoverAxis;
  isItemDisabled?: (element: HTMLElement) => boolean;
  gapClick?: boolean | { maxDistance?: number };
}

export interface PickNearestInput {
  axis: FluidHoverAxis;
  point: { x: number; y: number };
  rects: readonly (FluidHoverItemRect | undefined)[];
  containerRect: Pick<DOMRect, "left" | "top" | "width" | "height">;
  layoutSize: Pick<DOMRect, "width" | "height">;
  scroll: { x: number; y: number };
  border: { x: number; y: number };
  isDisabled?: (index: number) => boolean;
}

export interface UseFluidHoverReturn {
  activeIndex: number | null;
  setActiveIndex: Dispatch<SetStateAction<number | null>>;
  itemRects: Array<FluidHoverItemRect | undefined>;
  isMeasured: boolean;
  handlers: {
    onMouseMove: (event: MouseEvent<HTMLElement>) => void;
    onMouseLeave: () => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerLeave: () => void;
    onBlur: (event: FocusEvent<HTMLElement>) => void;
    onClick: (event: MouseEvent<HTMLElement>) => void;
  };
  registerItem: (index: number, element: HTMLElement | null) => void;
  getItemRef: (index: number) => (element: HTMLElement | null) => void;
  remeasure: () => void;
}

const activatorSelector =
  "a[href], button, [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [role='option'], [role='radio'], [role='checkbox'], [role='tab'], [role='link'], [role='button']";

/**
 * The hit rule is deliberately a linear scan: preset and navigation lists are
 * small, and the simple path keeps gaps, disabled items, and grids consistent.
 * ponytail: O(n) scan; use indexed intervals only when lists become large.
 */
export function pickNearest({
  axis,
  point,
  rects,
  containerRect,
  layoutSize,
  scroll,
  border,
  isDisabled,
}: PickNearestInput): number | null {
  const scaleX = layoutSize.width > 0 ? containerRect.width / layoutSize.width : 1;
  const scaleY = layoutSize.height > 0 ? containerRect.height / layoutSize.height : 1;
  let nearestIndex: number | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  let containingIndex: number | null = null;

  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index];
    if (!rect || isDisabled?.(index)) continue;

    const left = containerRect.left + (border.x + rect.left - scroll.x) * scaleX;
    const top = containerRect.top + (border.y + rect.top - scroll.y) * scaleY;
    const width = rect.width * scaleX;
    const height = rect.height * scaleY;

    if (axis === "xy") {
      if (point.x >= left && point.x <= left + width && point.y >= top && point.y <= top + height) {
        containingIndex = index;
      }
      const distance = Math.hypot(point.x - (left + width / 2), point.y - (top + height / 2));
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
      continue;
    }

    const horizontal = axis === "x";
    const pointer = horizontal ? point.x : point.y;
    const start = horizontal ? left : top;
    const size = horizontal ? width : height;
    if (pointer >= start && pointer <= start + size) containingIndex = index;

    const distance = Math.abs(pointer - (start + size / 2));
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  return containingIndex ?? nearestIndex;
}

function requestFrame(callback: () => void): number | null {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    callback();
    return null;
  }
  return window.requestAnimationFrame(callback);
}

function cancelFrame(frame: number | null): void {
  if (frame !== null && typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(frame);
  }
}

function readItemRect(element: HTMLElement, container: HTMLElement): FluidHoverItemRect | null {
  const elementRect = element.getBoundingClientRect();
  const width = element.offsetWidth || elementRect.width;
  const height = element.offsetHeight || elementRect.height;
  if (width <= 0 || height <= 0) return null;

  let top = element.offsetTop;
  let left = element.offsetLeft;
  let offsetParent = element.offsetParent as HTMLElement | null;
  while (offsetParent && offsetParent !== container && container.contains(offsetParent)) {
    top += offsetParent.offsetTop + offsetParent.clientTop;
    left += offsetParent.offsetLeft + offsetParent.clientLeft;
    offsetParent = offsetParent.offsetParent as HTMLElement | null;
  }

  if (offsetParent === container) return { top, left, width, height };

  const containerRect = container.getBoundingClientRect();
  return {
    top: elementRect.top - containerRect.top + container.scrollTop,
    left: elementRect.left - containerRect.left + container.scrollLeft,
    width,
    height,
  };
}

function resolveActivator(element: HTMLElement): HTMLElement {
  if (element.matches(activatorSelector) || element.hasAttribute("tabindex")) return element;
  return element.querySelector<HTMLElement>(activatorSelector) ?? element;
}

export function useFluidHover<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  { axis = "y", isItemDisabled, gapClick = true }: UseFluidHoverOptions = {},
): UseFluidHoverReturn {
  const { disableMotion } = useMotionLevel();
  const itemsRef = useRef(new Map<number, HTMLElement>());
  const itemRectsRef = useRef<Array<FluidHoverItemRect | undefined>>([]);
  const activeIndexRef = useRef<number | null>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const pointerPointRef = useRef<{ x: number; y: number } | null>(null);
  const measureFrameRef = useRef<number | null>(null);
  const itemResizeObserverRef = useRef<ResizeObserver | null>(null);
  const isMeasuredRef = useRef(false);
  const [activeIndex, setActiveIndexState] = useState<number | null>(null);
  const [itemRects, setItemRects] = useState<Array<FluidHoverItemRect | undefined>>([]);
  const [isMeasured, setIsMeasured] = useState(false);
  const gapClickMaxDistance = typeof gapClick === "object" ? (gapClick.maxDistance ?? Infinity) : Infinity;

  const setActiveIndex = useCallback<Dispatch<SetStateAction<number | null>>>((next) => {
    setActiveIndexState((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      activeIndexRef.current = resolved;
      return resolved;
    });
  }, []);

  // One-way latch: the layer only needs to know that rects exist. Losing
  // measurement must not unmount it, so nothing ever sets this back to false.
  const markMeasured = useCallback((): void => {
    isMeasuredRef.current = true;
    setIsMeasured(true);
  }, []);

  const publishMeasurement = useCallback((): boolean => {
    const container = containerRef.current;
    if (!container) return false;

    // Unmeasurable items publish as holes instead of blocking the list: one
    // zero-sized row must not leave every other row without a highlight, which
    // is what an all-or-nothing publish used to do.
    const nextRects: Array<FluidHoverItemRect | undefined> = [];
    itemsRef.current.forEach((element, index) => {
      nextRects[index] = readItemRect(element, container) ?? undefined;
    });

    const active = activeIndexRef.current;
    if (active !== null && !itemsRef.current.has(active)) setActiveIndex(null);

    const previous = itemRectsRef.current;
    let changed = previous.length !== nextRects.length;
    for (let index = 0; !changed && index < nextRects.length; index += 1) {
      const before = previous[index];
      const after = nextRects[index];
      changed =
        before?.top !== after?.top ||
        before?.left !== after?.left ||
        before?.width !== after?.width ||
        before?.height !== after?.height;
    }
    if (changed) {
      itemRectsRef.current = nextRects;
      setItemRects(nextRects);
    }
    return true;
  }, [containerRef, setActiveIndex]);

  // Measurement is a retarget, never a teardown: the hover layer stays mounted
  // while a new frame is pending and springs to the new rects. Hiding it here
  // made every remeasure (scroll, resize, item box change, re-registration)
  // unmount and remount the highlight, which reads as hover flicker.
  const scheduleMeasurement = useCallback((): void => {
    if (measureFrameRef.current !== null) return;
    measureFrameRef.current = requestFrame(() => {
      measureFrameRef.current = null;
      if (publishMeasurement()) markMeasured();
    });
  }, [publishMeasurement, markMeasured]);

  const remeasure = useCallback(() => scheduleMeasurement(), [scheduleMeasurement]);

  const scheduleMeasurementFromEvent = useCallback(() => scheduleMeasurement(), [scheduleMeasurement]);

  const ensureMeasured = useCallback((): boolean => {
    if (isMeasuredRef.current) return true;
    if (publishMeasurement()) {
      markMeasured();
      return true;
    }
    scheduleMeasurement();
    return false;
  }, [publishMeasurement, scheduleMeasurement, markMeasured]);

  const getItemResizeObserver = useCallback((): ResizeObserver | null => {
    if (itemResizeObserverRef.current === null && typeof ResizeObserver !== "undefined") {
      itemResizeObserverRef.current = new ResizeObserver(scheduleMeasurementFromEvent);
    }
    return itemResizeObserverRef.current;
  }, [scheduleMeasurementFromEvent]);

  const registerItem = useCallback(
    (index: number, element: HTMLElement | null): void => {
      const previous = itemsRef.current.get(index);
      if (previous && previous !== element) itemResizeObserverRef.current?.unobserve(previous);
      if (element) {
        itemsRef.current.set(index, element);
        getItemResizeObserver()?.observe(element);
      } else {
        itemsRef.current.delete(index);
      }
      remeasure();
    },
    // A null registration is not necessarily a removal: React detaches and
    // re-attaches a ref callback whenever its identity changes (selection
    // state, index shifts), so clearing activeIndex here killed the hover
    // layer on ordinary selection clicks. publishMeasurement owns the call.
    [getItemResizeObserver, remeasure],
  );

  const itemRefCallbacksRef = useRef(new Map<number, (element: HTMLElement | null) => void>());
  const getItemRef = useCallback(
    (index: number): ((element: HTMLElement | null) => void) => {
      const existing = itemRefCallbacksRef.current.get(index);
      if (existing) return existing;
      const callback = (element: HTMLElement | null): void => registerItem(index, element);
      itemRefCallbacksRef.current.set(index, callback);
      return callback;
    },
    [registerItem],
  );

  // Pointer events and the compatibility mouse events both land here, so the
  // pending point is overwritten and at most one measurement runs per frame.
  // Cancelling and rescheduling per event made the two paths fight over the
  // same frame slot and doubled the layout reads behind every move.
  const onMouseMove = useCallback(
    (event: MouseEvent<HTMLElement>): void => {
      if (disableMotion) return;
      pointerPointRef.current = { x: event.clientX, y: event.clientY };
      if (pointerFrameRef.current !== null) return;
      pointerFrameRef.current = requestFrame(() => {
        pointerFrameRef.current = null;
        const point = pointerPointRef.current;
        const container = containerRef.current;
        if (!point || !container || !ensureMeasured()) return;
        const containerRect = container.getBoundingClientRect();
        const index = pickNearest({
          axis,
          point,
          rects: itemRectsRef.current,
          containerRect,
          layoutSize: {
            width: container.offsetWidth || containerRect.width,
            height: container.offsetHeight || containerRect.height,
          },
          scroll: { x: container.scrollLeft, y: container.scrollTop },
          border: { x: container.clientLeft, y: container.clientTop },
          isDisabled: isItemDisabled
            ? (candidate) => {
                const element = itemsRef.current.get(candidate);
                return element ? isItemDisabled(element) : true;
              }
            : undefined,
        });
        setActiveIndex(index);
      });
    },
    [axis, containerRef, disableMotion, ensureMeasured, isItemDisabled, setActiveIndex],
  );

  // Keep pointer-move compatibility for existing consumers/tests; both routes
  // share one frame slot through onMouseMove.
  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>): void => {
      if (event.pointerType !== "touch") {
        onMouseMove(event);
      }
    },
    [onMouseMove],
  );

  const clearActive = useCallback(() => {
    cancelFrame(pointerFrameRef.current);
    pointerFrameRef.current = null;
    pointerPointRef.current = null;
    setActiveIndex(null);
  }, [setActiveIndex]);

  const onMouseLeave = useCallback(() => clearActive(), [clearActive]);

  const onBlur = useCallback(
    (event: FocusEvent<HTMLElement>): void => {
      const container = containerRef.current;
      if (container && event.relatedTarget instanceof Node && container.contains(event.relatedTarget)) return;
      clearActive();
    },
    [clearActive, containerRef],
  );

  const onClick = useCallback(
    (event: MouseEvent<HTMLElement>): void => {
      if (gapClick === false) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      for (const element of itemsRef.current.values()) {
        if (element.contains(target)) return;
      }
      if (!(target instanceof Element) || target.closest(activatorSelector)) return;
      const index = activeIndexRef.current;
      const element = index === null ? null : itemsRef.current.get(index);
      if (!element || isItemDisabled?.(element)) return;
      if (gapClickMaxDistance !== Infinity) {
        const rect = element.getBoundingClientRect();
        const distanceX = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
        const distanceY = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
        if (Math.hypot(distanceX, distanceY) > gapClickMaxDistance) return;
      }
      resolveActivator(element).click();
    },
    [gapClick, gapClickMaxDistance, isItemDisabled],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasurementFromEvent);
    observer?.observe(container);
    const scrollParent = container.parentElement;
    scrollParent?.addEventListener("scroll", scheduleMeasurementFromEvent, { passive: true });
    window.addEventListener("resize", scheduleMeasurementFromEvent);
    scheduleMeasurement();
    return () => {
      observer?.disconnect();
      scrollParent?.removeEventListener("scroll", scheduleMeasurementFromEvent);
      window.removeEventListener("resize", scheduleMeasurementFromEvent);
    };
  }, [containerRef, scheduleMeasurement, scheduleMeasurementFromEvent]);

  useEffect(() => {
    return () => {
      cancelFrame(pointerFrameRef.current);
      cancelFrame(measureFrameRef.current);
      itemResizeObserverRef.current?.disconnect();
      itemResizeObserverRef.current = null;
    };
  }, []);

  return {
    activeIndex,
    setActiveIndex,
    itemRects,
    isMeasured,
    handlers: { onMouseMove, onMouseLeave, onPointerMove, onPointerLeave: onMouseLeave, onBlur, onClick },
    registerItem,
    getItemRef,
    remeasure,
  };
}

export function useRegisterFluidHoverItem(
  registerItem: ((index: number, element: HTMLElement | null) => void) | undefined,
  index: number | undefined,
  ref: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!registerItem || index === undefined) return;
    registerItem(index, ref.current);
    return () => registerItem(index, null);
  }, [index, ref, registerItem]);
}
