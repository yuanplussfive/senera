import { AnimatePresence, motion } from "framer-motion";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefCallback,
} from "react";
import { cn } from "../../lib/util";
import { motionSprings, useMotionLevel } from "../motion";

interface SegmentRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function requestMeasurementFrame(callback: FrameRequestCallback): number {
  return typeof requestAnimationFrame === "function" ? requestAnimationFrame(callback) : window.setTimeout(callback, 0);
}

function cancelMeasurementFrame(frame: number): void {
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(frame);
  } else {
    window.clearTimeout(frame);
  }
}

export type FluidSegmentedVariant = "segmented" | "underline";

export interface FluidSegmentedSurface {
  readonly containerRef: RefCallback<HTMLDivElement>;
  readonly registerItem: (value: string, element: HTMLElement | null) => void;
  readonly onItemPointerEnter: (value: string, event: ReactPointerEvent<HTMLElement>) => void;
  readonly onItemPointerLeave: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly selectedRect: SegmentRect | null;
  readonly hoveredRect: SegmentRect | null;
  readonly isHoveringSelected: boolean;
}

function readRelativeRect(container: HTMLElement, item: HTMLElement): SegmentRect {
  const containerRect = container.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  return {
    left: itemRect.left - containerRect.left + container.scrollLeft,
    top: itemRect.top - containerRect.top + container.scrollTop,
    width: itemRect.width,
    height: itemRect.height,
  };
}

/**
 * Shared geometry for controls that present mutually exclusive choices. It
 * owns one selected layer and one hover layer, allowing Tabs and compact
 * segmented controls to retain their own semantic primitives without each
 * reimplementing layout observation and motion state.
 */
export function useFluidSegmentedSurface(selectedValue: string | undefined): FluidSegmentedSurface {
  const containerNodeRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef(new Map<string, HTMLElement>());
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const frameRef = useRef<number | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [hoveredValue, setHoveredValue] = useState<string>();
  const [rects, setRects] = useState<Record<string, SegmentRect>>({});

  const measure = useCallback(() => {
    const currentContainer = containerNodeRef.current;
    if (!currentContainer) return;
    const next = Object.fromEntries(
      Array.from(itemsRef.current, ([value, item]) => [value, readRelativeRect(currentContainer, item)]),
    ) as Record<string, SegmentRect>;
    setRects((previous) => {
      const values = new Set([...Object.keys(previous), ...Object.keys(next)]);
      for (const value of values) {
        const before = previous[value];
        const after = next[value];
        if (
          !before ||
          !after ||
          before.left !== after.left ||
          before.top !== after.top ||
          before.width !== after.width ||
          before.height !== after.height
        ) {
          return next;
        }
      }
      return previous;
    });
  }, []);

  const scheduleMeasurement = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestMeasurementFrame(() => {
      frameRef.current = null;
      measure();
    });
  }, [measure]);

  const containerRef = useCallback<RefCallback<HTMLDivElement>>((node) => {
    if (containerNodeRef.current === node) return;
    containerNodeRef.current = node;
    setContainer((current) => (current === node ? current : node));
  }, []);

  const registerItem = useCallback(
    (value: string, element: HTMLElement | null) => {
      if (element) {
        const previous = itemsRef.current.get(value);
        if (previous === element) return;
        if (previous && previous !== element) resizeObserverRef.current?.unobserve(previous);
        itemsRef.current.set(value, element);
        resizeObserverRef.current?.observe(element);
      } else {
        const previous = itemsRef.current.get(value);
        if (!previous) return;
        if (previous) resizeObserverRef.current?.unobserve(previous);
        itemsRef.current.delete(value);
      }
      scheduleMeasurement();
    },
    [scheduleMeasurement],
  );

  useLayoutEffect(() => {
    scheduleMeasurement();
  }, [scheduleMeasurement, selectedValue]);

  useEffect(() => {
    if (!container) return;
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasurement);
    resizeObserverRef.current = resizeObserver;
    resizeObserver?.observe(container);
    itemsRef.current.forEach((item) => resizeObserver?.observe(item));
    const mutationObserver = new MutationObserver(scheduleMeasurement);
    mutationObserver.observe(container, { childList: true, subtree: true });
    window.addEventListener("resize", scheduleMeasurement);
    return () => {
      resizeObserver?.disconnect();
      resizeObserverRef.current = null;
      mutationObserver.disconnect();
      window.removeEventListener("resize", scheduleMeasurement);
    };
  }, [container, scheduleMeasurement]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelMeasurementFrame(frameRef.current);
      frameRef.current = null;
    },
    [],
  );

  const onItemPointerEnter = useCallback((value: string, event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch") setHoveredValue(value);
  }, []);
  const onItemPointerLeave = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;
    if (event.pointerType === "touch" || (nextTarget instanceof Node && containerNodeRef.current?.contains(nextTarget)))
      return;
    setHoveredValue(undefined);
  }, []);

  return {
    containerRef,
    registerItem,
    onItemPointerEnter,
    onItemPointerLeave,
    selectedRect: selectedValue ? (rects[selectedValue] ?? null) : null,
    hoveredRect: hoveredValue ? (rects[hoveredValue] ?? null) : null,
    isHoveringSelected: hoveredValue === selectedValue,
  };
}

function target(
  rect: SegmentRect,
  variant: FluidSegmentedVariant,
): { left: number; top: number; width: number; height: number } {
  if (variant === "underline") {
    return { left: rect.left, top: rect.top + rect.height - 1, width: rect.width, height: 1 };
  }
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

export function FluidSegmentedLayers({
  surface,
  variant = "segmented",
  selectionClassName,
  hoverClassName,
  hideSelection = false,
  hideHover = false,
}: {
  surface: FluidSegmentedSurface;
  variant?: FluidSegmentedVariant;
  /** Themed workbenches may supply their own surface tokens without owning layout or motion. */
  selectionClassName?: string;
  hoverClassName?: string;
  hideSelection?: boolean;
  hideHover?: boolean;
}): JSX.Element | null {
  const { reduceMotion, disableMotion } = useMotionLevel();
  const transition = disableMotion || reduceMotion ? { duration: 0 } : motionSprings.soft;
  const selected = surface.selectedRect;
  const hovered = surface.hoveredRect;

  return (
    <>
      {selected && !hideSelection ? (
        <motion.span
          aria-hidden="true"
          data-fluid-segmented-selection
          className={cn(
            variant === "underline"
              ? "pointer-events-none absolute z-0 bg-content-primary"
              : "pointer-events-none absolute z-0 rounded-md border border-line-subtle bg-surface-raised shadow-sm",
            selectionClassName,
          )}
          initial={false}
          animate={{ ...target(selected, variant), opacity: hovered && !surface.isHoveringSelected ? 0.86 : 1 }}
          transition={{ ...transition, opacity: { duration: disableMotion ? 0 : 0.08 } }}
        />
      ) : null}
      <AnimatePresence initial={false}>
        {hovered && !surface.isHoveringSelected && !hideHover ? (
          <motion.span
            aria-hidden="true"
            data-fluid-segmented-hover
            className={cn(
              variant === "underline"
                ? "pointer-events-none absolute z-0 bg-content-secondary/45"
                : "pointer-events-none absolute z-0 rounded-md bg-surface-hover",
              hoverClassName,
            )}
            initial={
              selected ? { ...target(selected, variant), opacity: 0 } : { ...target(hovered, variant), opacity: 0 }
            }
            animate={{ ...target(hovered, variant), opacity: variant === "underline" ? 0.6 : 0.72 }}
            exit={selected ? { ...target(selected, variant), opacity: 0 } : { opacity: 0 }}
            transition={{ ...transition, opacity: { duration: disableMotion ? 0 : 0.08 } }}
          />
        ) : null}
      </AnimatePresence>
    </>
  );
}
