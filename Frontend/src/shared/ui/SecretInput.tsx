import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { AppIcon } from "./AppIcon";

export interface SecretInputProps {
  value: string;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;

  showClearButton?: boolean;
  clearButtonLabel?: string;

  onChange: (value: string) => void;
  onBlur?: () => void;
  onClear?: () => void;
}

export function SecretInput({
  value,
  disabled,
  placeholder,
  ariaLabel,
  className,
  showClearButton,
  clearButtonLabel = frontendMessage("settings.mcp.clearSecret"),
  onChange,
  onBlur,
  onClear,
}: SecretInputProps): JSX.Element {
  const [revealed, setRevealed] = useState(false);

  const preventBlur = (e: MouseEvent<HTMLButtonElement>) => e.preventDefault();

  return (
    <div className="relative flex h-9 min-w-0 overflow-hidden rounded-md border border-ink-200/80 bg-paper-50 transition-[border-color,box-shadow] focus-within:border-accent-border focus-within:ring-2 focus-within:ring-accent-focus">
      <input
        type={revealed ? "text" : "password"}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        spellCheck={false}
        className={cn(
          "h-full min-w-0 flex-1 border-0 bg-transparent px-3 text-[13px] text-ink-900 outline-none placeholder:text-ink-400 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        onChange={(e) => onChange(e.currentTarget.value)}
        onBlur={onBlur}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") onBlur?.();
        }}
      />

      <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
        {showClearButton && onClear ? (
          <button
            type="button"
            disabled={disabled}
            className="grid h-7 w-7 place-items-center rounded text-ink-450 transition hover:bg-ink-900/[0.05] hover:text-brick-600 disabled:pointer-events-none disabled:opacity-40"
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
          className="grid h-7 w-7 place-items-center rounded text-ink-450 transition hover:bg-ink-900/[0.05] hover:text-ink-800 disabled:pointer-events-none disabled:opacity-40"
          onClick={() => setRevealed(!revealed)}
          onMouseDown={preventBlur}
          aria-label={frontendMessage(revealed ? "settings.mcp.hideSecret" : "settings.mcp.showSecret")}
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
