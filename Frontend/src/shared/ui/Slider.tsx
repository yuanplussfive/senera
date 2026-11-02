import {
  useMemo,
  useRef,
  useState,
  useEffect,
  type ChangeEvent,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "../../lib/util";
import { useMotionLevel } from "../motion";

export type SliderSize = "default" | "compact";
export type SliderVariant = "pips" | "scrubber";

export interface SliderMark {
  value: number;
  label?: ReactNode;
}

export interface SliderProps extends Omit<
  ComponentPropsWithoutRef<"input">,
  "aria-label" | "defaultValue" | "max" | "min" | "onChange" | "onInput" | "size" | "step" | "type" | "value"
> {
  ariaLabel: string;
  value: number;
  onValueChange: (value: number) => void;
  /**
   * Delivers the settled value after pointer or keyboard interaction. Use it
   * for durable work while onValueChange keeps an inexpensive preview live.
   */
  onValueCommit?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  steps?: readonly number[];
  marks?: readonly SliderMark[];
  label?: ReactNode;
  showValue?: boolean;
  formatValue?: (value: number) => string;
  size?: SliderSize;
  variant?: SliderVariant;
  className?: string;
}

interface SliderBounds {
  min: number;
  max: number;
  steps: readonly number[];
}

const defaultSliderBounds = { min: 0, max: 100 } as const;

/**
 * Shared single-value range control. The native range input remains the
 * interaction surface, while the rendered rail supplies a consistent
 * pip/scrubber treatment everywhere in the application.
 */
export function Slider({
  ariaLabel,
  value,
  onValueChange,
  onValueCommit,
  min = defaultSliderBounds.min,
  max = defaultSliderBounds.max,
  step = 1,
  steps,
  marks,
  label,
  showValue = false,
  formatValue = String,
  size = "default",
  variant = "pips",
  disabled = false,
  className,
  onKeyDown,
  onKeyUp,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onBlur,
  ...inputProps
}: SliderProps): JSX.Element {
  const bounds = useMemo(() => resolveSliderBounds(min, max, steps), [max, min, steps]);
  const normalizedValue = normalizeSliderValue(value, bounds);
  const interactionValueRef = useRef(normalizedValue);
  const interactionRevisionRef = useRef(0);
  const committedRevisionRef = useRef(0);
  const [isPointerDragging, setIsPointerDragging] = useState(false);
  useEffect(() => {
    interactionValueRef.current = normalizedValue;
  }, [normalizedValue]);
  const progress = readSliderProgress(normalizedValue, bounds);
  const visibleMarks: readonly SliderMark[] =
    marks ?? (variant === "pips" ? bounds.steps.map((entry) => ({ value: entry })) : []);
  const selectedMark = closestMarkIndex(visibleMarks, normalizedValue);
  const { disableMotion, reduceMotion } = useMotionLevel();
  // Values must follow a direct manipulation pointer without an easing tail.
  // The eased transition remains useful for keyboard and programmatic updates.
  const animatedClass =
    disableMotion || reduceMotion || isPointerDragging
      ? "transition-none"
      : "transition-[left,width,background-color] duration-150 ease-out";
  const metrics = size === "compact" ? compactMetrics : defaultMetrics;
  const valueText = formatValue(normalizedValue);

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const nextValue = normalizeSliderValue(Number(event.currentTarget.value), bounds);
    if (nextValue === interactionValueRef.current) return;
    interactionValueRef.current = nextValue;
    interactionRevisionRef.current += 1;
    onValueChange(nextValue);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    onKeyDown?.(event);
    if (event.defaultPrevented || bounds.steps.length === 0) return;
    const target = readKeyboardStepValue(event.key, normalizedValue, bounds.steps);
    if (target === undefined) return;
    event.preventDefault();
    if (target === interactionValueRef.current) return;
    interactionValueRef.current = target;
    interactionRevisionRef.current += 1;
    onValueChange(target);
  };

  const commitValue = (): void => {
    if (committedRevisionRef.current === interactionRevisionRef.current) return;
    committedRevisionRef.current = interactionRevisionRef.current;
    onValueCommit?.(interactionValueRef.current);
  };

  return (
    <div
      className={cn("grid min-w-0 gap-2", disabled && "opacity-55", className)}
      data-slider
      data-slider-size={size}
      data-slider-variant={variant}
      data-disabled={disabled || undefined}
      data-slider-interacting={isPointerDragging || undefined}
    >
      {label || showValue ? (
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          {label ? <span className="min-w-0 text-[12px] font-medium text-content-primary">{label}</span> : <span />}
          {showValue ? (
            <output className="shrink-0 tabular-nums text-[11.5px] font-medium text-content-secondary">
              {valueText}
            </output>
          ) : null}
        </div>
      ) : null}
      <div
        className={cn(
          "relative min-w-0 rounded-sm",
          "focus-within:ring-2 focus-within:ring-accent-focus/70 focus-within:ring-offset-2 focus-within:ring-offset-surface-panel",
          disabled && "cursor-not-allowed",
          metrics.trackArea,
        )}
      >
        <input
          {...inputProps}
          type="range"
          min={bounds.min}
          max={bounds.max}
          step={bounds.steps.length > 0 ? "any" : step}
          value={normalizedValue}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-valuetext={valueText}
          className="absolute inset-x-0 top-1/2 z-20 h-10 w-full -translate-y-1/2 cursor-pointer opacity-0 disabled:cursor-not-allowed"
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onKeyUp={(event) => {
            onKeyUp?.(event);
            if (!event.defaultPrevented && isSliderCommitKey(event.key)) commitValue();
          }}
          onPointerDown={(event) => {
            onPointerDown?.(event);
            if (!event.defaultPrevented) setIsPointerDragging(true);
          }}
          onPointerUp={(event) => {
            onPointerUp?.(event);
            if (!event.defaultPrevented) {
              setIsPointerDragging(false);
              commitValue();
            }
          }}
          onPointerCancel={(event) => {
            onPointerCancel?.(event);
            if (!event.defaultPrevented) {
              setIsPointerDragging(false);
              commitValue();
            }
          }}
          onBlur={(event) => {
            onBlur?.(event);
            if (!event.defaultPrevented) {
              setIsPointerDragging(false);
              commitValue();
            }
          }}
        />
        <span
          className={cn(
            "pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full",
            disabled ? "bg-line-subtle" : "bg-line-strong/80",
            metrics.rail,
          )}
          aria-hidden="true"
        >
          <span
            className={cn(
              "absolute inset-y-0 left-0 rounded-full",
              disabled ? "bg-content-disabled" : "bg-accent-solid",
              animatedClass,
            )}
            style={{ width: `${progress}%` }}
          />
        </span>
        {visibleMarks.map((mark, index) => {
          const markProgress = readSliderProgress(mark.value, bounds);
          const isSelected = index === selectedMark;
          const isPassed = mark.value <= normalizedValue;
          return (
            <span
              key={`${mark.value}:${index}`}
              className={cn(
                "pointer-events-none absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-surface-panel",
                metrics.pip,
                disabled ? "bg-content-disabled" : isPassed ? "bg-accent-solid" : "bg-line-strong",
                isSelected && !disabled && "ring-2 ring-accent-focus/35",
                animatedClass,
              )}
              style={{ left: `${markProgress}%` }}
              aria-hidden="true"
              data-slider-mark={mark.value}
              data-slider-mark-selected={isSelected || undefined}
            />
          );
        })}
        <span
          className={cn(
            "pointer-events-none absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent-solid bg-surface-panel shadow-soft",
            metrics.thumb,
            disabled && "border-content-disabled bg-surface-muted shadow-none",
            animatedClass,
          )}
          style={{ left: `${progress}%` }}
          aria-hidden="true"
          data-slider-thumb
        />
      </div>
      {visibleMarks.some((mark) => mark.label !== undefined) ? (
        <div className="relative h-4 text-[11px] leading-4 text-content-muted" aria-hidden="true">
          {visibleMarks.map((mark, index) => {
            const markProgress = readSliderProgress(mark.value, bounds);
            const isSelected = index === selectedMark;
            return (
              <span
                key={`${mark.value}:${index}`}
                className={cn(
                  "absolute top-0 whitespace-nowrap",
                  isSelected ? "font-medium text-accent-content" : "text-content-muted",
                )}
                style={{
                  left: `${markProgress}%`,
                  transform:
                    markProgress === 0
                      ? "translateX(0)"
                      : markProgress === 100
                        ? "translateX(-100%)"
                        : "translateX(-50%)",
                }}
                data-slider-mark-label={mark.value}
              >
                {mark.label}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

const defaultMetrics = {
  trackArea: "h-9",
  rail: "h-1",
  pip: "h-2 w-2",
  thumb: "h-4 w-4",
} as const;

const compactMetrics = {
  trackArea: "h-7",
  rail: "h-[3px]",
  pip: "h-1.5 w-1.5",
  thumb: "h-3.5 w-3.5",
} as const;

function resolveSliderBounds(min: number, max: number, steps: readonly number[] | undefined): SliderBounds {
  const normalizedSteps = steps ? [...new Set(steps)].sort((left, right) => left - right) : [];
  const start = normalizedSteps[0] ?? min;
  const end = normalizedSteps.at(-1) ?? max;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new RangeError("Slider requires a finite range where max is greater than min.");
  }
  return { min: start, max: end, steps: normalizedSteps };
}

function normalizeSliderValue(value: number, bounds: SliderBounds): number {
  const clamped = Math.min(Math.max(value, bounds.min), bounds.max);
  if (bounds.steps.length === 0) return clamped;
  return bounds.steps.reduce((closest, candidate) =>
    Math.abs(candidate - clamped) < Math.abs(closest - clamped) ? candidate : closest,
  );
}

function readSliderProgress(value: number, bounds: SliderBounds): number {
  return ((value - bounds.min) / (bounds.max - bounds.min)) * 100;
}

function closestMarkIndex(marks: readonly SliderMark[], value: number): number {
  if (marks.length === 0) return -1;
  return marks.reduce(
    (closestIndex, mark, index) =>
      Math.abs(mark.value - value) < Math.abs(marks[closestIndex].value - value) ? index : closestIndex,
    0,
  );
}

function readKeyboardStepValue(key: string, value: number, steps: readonly number[]): number | undefined {
  if (key === "Home") return steps[0];
  if (key === "End") return steps.at(-1);
  const currentIndex = closestMarkIndex(
    steps.map((entry) => ({ value: entry })),
    value,
  );
  if (key === "ArrowLeft" || key === "ArrowDown" || key === "PageDown") return steps[Math.max(0, currentIndex - 1)];
  if (key === "ArrowRight" || key === "ArrowUp" || key === "PageUp")
    return steps[Math.min(steps.length - 1, currentIndex + 1)];
  return undefined;
}

function isSliderCommitKey(key: string): boolean {
  return (
    key === "ArrowLeft" ||
    key === "ArrowRight" ||
    key === "ArrowUp" ||
    key === "ArrowDown" ||
    key === "PageUp" ||
    key === "PageDown" ||
    key === "Home" ||
    key === "End"
  );
}
