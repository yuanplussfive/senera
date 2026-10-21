import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { cn } from "../../lib/util";
import { useResponsiveMode } from "../responsive";

export type ScrollAreaOrientation = "vertical" | "horizontal" | "both";

export interface ScrollAreaProps extends ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> {
  viewportClassName?: string;
  /** Axes that receive a visible overlay scrollbar. */
  orientation?: ScrollAreaOrientation;
}

const ScrollAreaDeviceContext = createContext(false);
const ScrollbarVisibilityContext = createContext(true);
const scrollbarVisibilityLingerMs = 600;

export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(
  (
    {
      className,
      viewportClassName,
      children,
      orientation = "vertical",
      onPointerEnter,
      onPointerLeave,
      onScroll,
      scrollHideDelay: _scrollHideDelay,
      ...props
    },
    ref,
  ) => {
    const { isCoarsePointer } = useResponsiveMode();
    const [hovering, setHovering] = useState(false);
    const [scrolling, setScrolling] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const revealForScroll = useCallback(
      (event: React.UIEvent<HTMLDivElement>) => {
        onScroll?.(event);
        setScrolling(true);
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          setScrolling(false);
        }, scrollbarVisibilityLingerMs);
      },
      [onScroll],
    );

    useEffect(
      () => () => {
        if (timerRef.current !== null) clearTimeout(timerRef.current);
      },
      [],
    );

    const viewportClass = cn(
      "h-full w-full rounded-[inherit]",
      isCoarsePointer && orientation === "vertical" && "overflow-y-auto",
      isCoarsePointer && orientation === "horizontal" && "overflow-x-auto",
      isCoarsePointer && orientation === "both" && "overflow-auto",
      viewportClassName,
    );

    return (
      <ScrollAreaDeviceContext.Provider value={isCoarsePointer}>
        {isCoarsePointer ? (
          <div
            ref={ref}
            role="group"
            aria-roledescription="scroll area"
            data-slot="scroll-area"
            className={cn("relative overflow-hidden", className)}
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
            {...props}
          >
            <div data-slot="scroll-area-viewport" className={viewportClass} tabIndex={0} onScroll={revealForScroll}>
              {children}
            </div>
          </div>
        ) : (
          <ScrollbarVisibilityContext.Provider value={hovering || scrolling}>
            <ScrollAreaPrimitive.Root
              ref={ref}
              type="always"
              data-slot="scroll-area"
              className={cn("relative overflow-hidden", className)}
              onPointerEnter={(event) => {
                setHovering(true);
                onPointerEnter?.(event);
              }}
              onPointerLeave={(event) => {
                setHovering(false);
                onPointerLeave?.(event);
              }}
              {...props}
            >
              <ScrollAreaPrimitive.Viewport
                data-slot="scroll-area-viewport"
                className={viewportClass}
                onScroll={revealForScroll}
              >
                {children}
              </ScrollAreaPrimitive.Viewport>
              {orientation !== "horizontal" ? <ScrollBar orientation="vertical" /> : null}
              {orientation !== "vertical" ? <ScrollBar orientation="horizontal" /> : null}
              {orientation === "both" ? <ScrollAreaPrimitive.Corner /> : null}
            </ScrollAreaPrimitive.Root>
          </ScrollbarVisibilityContext.Provider>
        )}
      </ScrollAreaDeviceContext.Provider>
    );
  },
);
ScrollArea.displayName = "ScrollArea";

export const ScrollBar = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => {
  const isCoarsePointer = useContext(ScrollAreaDeviceContext);
  const visible = useContext(ScrollbarVisibilityContext);
  if (isCoarsePointer) return null;

  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      ref={ref}
      orientation={orientation}
      data-slot="scroll-area-scrollbar"
      data-visible={visible ? "" : undefined}
      className={cn(
        "group/scrollbar z-20 flex touch-none select-none opacity-0 transition-opacity duration-120 ease-out delay-160",
        "pointer-events-none data-[visible]:pointer-events-auto data-[visible]:opacity-100 data-[visible]:delay-0 data-[visible]:duration-160",
        orientation === "vertical" && "h-full w-2.5",
        orientation === "horizontal" && "h-2.5 w-full flex-col",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className={cn(
          "relative bg-[var(--scrollbar-thumb)] transition-[background-color,width,height] duration-160 ease-in-out",
          "group-hover/scrollbar:bg-[var(--scrollbar-thumb-hover)] active:!bg-[var(--scrollbar-thumb-active)]",
          orientation === "vertical" && "mx-auto my-1 w-1 -translate-x-0.5 group-hover/scrollbar:w-1.5",
          orientation === "horizontal" && "my-auto mx-1 h-1 -translate-y-0.5 group-hover/scrollbar:h-1.5",
        )}
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
});
ScrollBar.displayName = "ScrollBar";
