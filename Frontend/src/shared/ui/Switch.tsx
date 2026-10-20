import { animate, motion, useMotionValue, type Transition } from "framer-motion";
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "../../lib/util";
import { motionSprings, useMotionLevel } from "../motion";
import { Tooltip } from "./Tooltip";

export type SwitchSize = "sm" | "md";

export interface SwitchTrackProps {
  checked: boolean;
  disabled?: boolean;
  size?: SwitchSize;
  className?: string;
}

export interface SwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-checked" | "aria-label" | "onClick" | "onChange" | "type"
> {
  checked: boolean;
  ariaLabel: string;
  onCheckedChange: (checked: boolean) => void;
  /** Explains why a disabled switch cannot be changed while keeping it visibly disabled. */
  disabledReason?: ReactNode;
  /** Handles an intentional click on a disabled switch with an explanation. */
  onDisabledClick?: () => void;
  size?: SwitchSize;
  trackClassName?: string;
}

interface SwitchMetrics {
  trackWidth: number;
  trackHeight: number;
  thumbSize: number;
  pillExtend: number;
  pressExtend: number;
  pressShrink: number;
}

const switchMetrics: Record<SwitchSize, SwitchMetrics> = {
  sm: { trackWidth: 28, trackHeight: 16, thumbSize: 12, pillExtend: 2, pressExtend: 3, pressShrink: 3 },
  md: { trackWidth: 34, trackHeight: 20, thumbSize: 16, pillExtend: 2, pressExtend: 4, pressShrink: 4 },
};

const thumbInset = 2;
const dragDeadZone = 2;

function restingPosition(checked: boolean, metrics: SwitchMetrics): number {
  return checked ? metrics.trackWidth - metrics.thumbSize - thumbInset : thumbInset;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function SwitchVisual({
  checked,
  disabled,
  size,
  hovered = false,
  pressed = false,
  trackClassName,
  x,
}: {
  checked: boolean;
  disabled: boolean;
  size: SwitchSize;
  hovered?: boolean;
  pressed?: boolean;
  trackClassName?: string;
  x: ReturnType<typeof useMotionValue<number>>;
}): JSX.Element {
  const { reduceMotion, disableMotion } = useMotionLevel();
  const metrics = switchMetrics[size];
  const thumbWidth = pressed
    ? metrics.thumbSize + metrics.pressExtend
    : hovered
      ? metrics.thumbSize + metrics.pillExtend
      : metrics.thumbSize;
  const thumbHeight = pressed ? metrics.thumbSize - metrics.pressShrink : metrics.thumbSize;
  const thumbTop = pressed ? thumbInset + metrics.pressShrink / 2 : thumbInset;
  const thumbTransition: Transition = disableMotion || reduceMotion ? { duration: 0 } : motionSprings.soft;
  const trackState = disabled
    ? "bg-surface-muted ring-1 ring-inset ring-content-disabled"
    : checked
      ? "bg-content-strong ring-1 ring-inset ring-content-strong"
      : "bg-ink-300 ring-1 ring-inset ring-ink-300";

  return (
    <motion.span
      aria-hidden="true"
      data-state={checked ? "checked" : "unchecked"}
      data-disabled={disabled || undefined}
      className={cn("relative inline-block shrink-0 rounded-full", trackState, trackClassName)}
      style={{ width: metrics.trackWidth, height: metrics.trackHeight }}
      animate={{ opacity: disabled ? 0.62 : 1 }}
      transition={thumbTransition}
    >
      <motion.span
        className={cn(
          "absolute left-0 rounded-full shadow-sm",
          disabled ? "bg-content-disabled shadow-none" : "bg-paper-50",
        )}
        style={{ x }}
        animate={{
          width: thumbWidth,
          height: thumbHeight,
          top: thumbTop,
          // Keep the checked thumb's outer edge aligned while hover/press
          // grows the pill toward the track interior.
          marginLeft: checked ? metrics.thumbSize - thumbWidth : 0,
        }}
        transition={thumbTransition}
      />
    </motion.span>
  );
}

/** Inert presentation for rows that already own a single switch button. */
export function SwitchTrack({ checked, disabled = false, size = "sm", className }: SwitchTrackProps): JSX.Element {
  const metrics = switchMetrics[size];
  const x = useMotionValue(restingPosition(checked, metrics));
  const { reduceMotion, disableMotion } = useMotionLevel();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    const control = animate(
      x,
      restingPosition(checked, metrics),
      disableMotion || reduceMotion ? { duration: 0 } : motionSprings.soft,
    );
    return () => control.stop();
  }, [checked, disableMotion, metrics, reduceMotion, x]);

  return (
    <span
      className="inline-flex"
      onPointerEnter={(event) => {
        if (!disabled && event.pointerType !== "touch") setHovered(true);
      }}
      onPointerLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onPointerDown={() => {
        if (!disabled) setPressed(true);
      }}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
    >
      <SwitchVisual
        checked={checked}
        disabled={disabled}
        size={size}
        hovered={hovered}
        pressed={pressed}
        trackClassName={className}
        x={x}
      />
    </span>
  );
}

export function Switch({
  checked,
  disabled = false,
  ariaLabel,
  disabledReason,
  onDisabledClick,
  onCheckedChange,
  size = "sm",
  trackClassName,
  className,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  ...buttonProps
}: SwitchProps): JSX.Element {
  const metrics = switchMetrics[size];
  const x = useMotionValue(restingPosition(checked, metrics));
  const { reduceMotion, disableMotion } = useMotionLevel();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const pointerRef = useRef<{ pointerId: number; clientX: number; originX: number } | null>(null);
  const draggedRef = useRef(false);
  const swallowClickRef = useRef(false);

  useEffect(() => {
    const control = animate(
      x,
      restingPosition(checked, metrics),
      disableMotion || reduceMotion ? { duration: 0 } : motionSprings.soft,
    );
    return () => control.stop();
  }, [checked, disableMotion, metrics, reduceMotion, x]);

  const stopPointerInteraction = (event: ReactPointerEvent<HTMLButtonElement>, commit: boolean): void => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    pointerRef.current = null;
    setPressed(false);
    if (!draggedRef.current) return;
    swallowClickRef.current = true;
    const nextChecked = x.get() >= (metrics.trackWidth - metrics.thumbSize) / 2;
    if (commit && nextChecked !== checked) onCheckedChange(nextChecked);
    const control = animate(
      x,
      restingPosition(commit ? nextChecked : checked, metrics),
      disableMotion || reduceMotion ? { duration: 0 } : motionSprings.soft,
    );
    void control.then(() => undefined);
    window.setTimeout(() => {
      swallowClickRef.current = false;
      draggedRef.current = false;
    }, 0);
  };

  const switchButton = (
    <button
      {...buttonProps}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      disabled={disabled && !onDisabledClick}
      className={cn(
        "inline-flex min-h-8 shrink-0 items-center outline-none",
        "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent-border",
        "disabled:pointer-events-none disabled:cursor-not-allowed",
        disabled && onDisabledClick && "cursor-not-allowed",
        className,
      )}
      onClick={(event) => {
        if (disabled) {
          onDisabledClick?.();
          return;
        }
        if (swallowClickRef.current) {
          event.preventDefault();
          return;
        }
        onCheckedChange(!checked);
      }}
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        if (event.pointerType !== "touch") setHovered(true);
      }}
      onPointerLeave={(event) => {
        onPointerLeave?.(event);
        if (event.pointerType !== "touch" && pointerRef.current === null) setHovered(false);
      }}
      onPointerDown={(event) => {
        if (disabled) return;
        onPointerDown?.(event);
        if (event.button !== 0) return;
        pointerRef.current = { pointerId: event.pointerId, clientX: event.clientX, originX: x.get() };
        draggedRef.current = false;
        setPressed(true);
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        onPointerMove?.(event);
        const pointer = pointerRef.current;
        if (!pointer || pointer.pointerId !== event.pointerId) return;
        const delta = event.clientX - pointer.clientX;
        if (!draggedRef.current && Math.abs(delta) < dragDeadZone) return;
        draggedRef.current = true;
        const maximum = metrics.trackWidth - metrics.thumbSize - thumbInset;
        x.set(clamp(pointer.originX + delta, thumbInset, maximum));
      }}
      onPointerUp={(event) => {
        onPointerUp?.(event);
        stopPointerInteraction(event, true);
      }}
      onPointerCancel={(event) => {
        onPointerCancel?.(event);
        stopPointerInteraction(event, false);
      }}
    >
      <SwitchVisual
        checked={checked}
        disabled={disabled}
        size={size}
        hovered={hovered}
        pressed={pressed}
        trackClassName={trackClassName}
        x={x}
      />
    </button>
  );

  if (!disabledReason || !onDisabledClick) return switchButton;
  return (
    <Tooltip content={disabledReason} side="top">
      {switchButton}
    </Tooltip>
  );
}
