import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../../lib/util";

export interface SegmentedControlOption<TValue extends string> {
  value: TValue;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<TValue extends string> {
  ariaLabel: string;
  options: readonly SegmentedControlOption<TValue>[];
  value: TValue | "";
  disabled?: boolean;
  className?: string;
  onChange: (value: TValue) => void;
}

export function SegmentedControl<TValue extends string>({
  ariaLabel,
  options,
  value,
  disabled = false,
  className,
  onChange,
}: SegmentedControlProps<TValue>): JSX.Element {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectRelativeOption = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    let nextIndex = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : index + direction;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;

    event.preventDefault();
    for (let attempts = 0; attempts < options.length; attempts += 1) {
      nextIndex = (nextIndex + options.length) % options.length;
      const option = options[nextIndex];
      if (!option.disabled) {
        onChange(option.value);
        itemRefs.current[nextIndex]?.focus();
        return;
      }
      nextIndex += direction;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-grid min-h-9 min-w-0 grid-flow-col auto-cols-fr items-center gap-0.5 rounded-lg bg-surface-subtle p-1 ring-1 ring-inset ring-line-subtle",
        className,
      )}
    >
      {options.map((option, index) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled || option.disabled}
            tabIndex={selected || (!value && index === 0) ? 0 : -1}
            className={cn(
              "inline-flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-md px-3 text-[12px] font-medium outline-none",
              "transition-[background-color,color,box-shadow] duration-150 ease-out",
              "focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-accent-focus",
              "disabled:pointer-events-none disabled:opacity-45",
              selected
                ? "bg-surface-raised text-content-primary shadow-sm ring-1 ring-inset ring-line-subtle"
                : "text-content-secondary hover:bg-surface-hover hover:text-content-primary",
            )}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => selectRelativeOption(event, index)}
          >
            {option.icon}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
