import { useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { AppIcon } from "./AppIcon";

export interface SecretInputProps {
  value: string;
  size?: "sm" | "md";
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  name?: string;
  autoComplete?: string;
  required?: boolean;
  showLabel?: string;
  hideLabel?: string;

  showClearButton?: boolean;
  clearButtonLabel?: string;

  onChange: (value: string) => void;
  onBlur?: () => void;
  onClear?: () => void;
}

export function SecretInput({
  value,
  size = "sm",
  disabled,
  placeholder,
  ariaLabel,
  className,
  name,
  autoComplete,
  required,
  showLabel = frontendMessage("settings.mcp.showSecret"),
  hideLabel = frontendMessage("settings.mcp.hideSecret"),
  showClearButton,
  clearButtonLabel = frontendMessage("settings.mcp.clearSecret"),
  onChange,
  onBlur,
  onClear,
}: SecretInputProps): JSX.Element {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!value) setRevealed(false);
  }, [value]);

  const preventBlur = (e: MouseEvent<HTMLButtonElement>) => e.preventDefault();
  const compact = size === "sm";

  return (
    <div
      className={cn(
        compact
          ? "relative flex h-9 w-full min-w-0 overflow-hidden rounded-md border border-line bg-surface-panel"
          : "relative flex h-11 w-full min-w-0 overflow-hidden rounded-lg border border-line bg-surface-panel",
        "transition-[border-color,box-shadow]",
      )}
    >
      <input
        name={name}
        autoComplete={autoComplete}
        required={required}
        type={revealed ? "text" : "password"}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        spellCheck={false}
        className={cn(
          compact
            ? "h-full min-w-0 flex-1 border-0 bg-transparent px-3 text-[13px] text-content-primary outline-none placeholder:text-content-muted"
            : "h-full min-w-0 flex-1 border-0 bg-transparent px-3.5 text-[14px] text-content-primary outline-none placeholder:text-content-muted",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        onChange={(e) => onChange(e.currentTarget.value)}
        onBlur={onBlur}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") onBlur?.();
        }}
      />

      <div className="flex h-full shrink-0 items-center border-l border-line-subtle px-1">
        {showClearButton && onClear ? (
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "grid w-7 place-items-center rounded text-content-muted transition hover:bg-surface-hover hover:text-brick-600 disabled:pointer-events-none disabled:opacity-40",
              compact ? "h-7" : "h-8",
            )}
            onClick={onClear}
            onMouseDown={preventBlur}
            aria-label={clearButtonLabel}
          >
            <AppIcon icon="trash" size={14} aria-hidden="true" />
          </button>
        ) : null}

        <button
          type="button"
          disabled={disabled || !value}
          className={cn(
            "grid w-7 place-items-center rounded text-content-muted transition hover:bg-surface-hover hover:text-content-primary disabled:pointer-events-none disabled:opacity-40",
            compact ? "h-7" : "h-8",
          )}
          onClick={() => setRevealed(!revealed)}
          onMouseDown={preventBlur}
          aria-label={revealed ? hideLabel : showLabel}
          aria-pressed={revealed}
        >
          {revealed ? (
            <AppIcon icon="eye-off" size={14} aria-hidden="true" />
          ) : (
            <AppIcon icon="eye" size={14} aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}
