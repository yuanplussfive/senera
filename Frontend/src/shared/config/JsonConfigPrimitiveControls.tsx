import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { ConfigFormFieldData } from "../../api/eventTypes";
import { cn } from "../../lib/util";
import {
  optionLabel,
  readNumberDraftBlurValue,
  readNumberDraftCommitValue,
  sameOptionValue,
} from "./jsonConfigFormModel";
import { jsonConfigFormMessages } from "./jsonConfigFormMessages";

export function OptionControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: ConfigFormFieldData;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}): JSX.Element {
  const options = field.options ?? [];
  if (options.length <= 4) {
    return (
      <div className="grid w-full grid-cols-1 gap-1.5 sm:grid-cols-2">
        {options.map((option) => {
          const active = sameOptionValue(value, option);
          return (
            <button
              key={String(option)}
              type="button"
              disabled={disabled}
              className={cn(
                "inline-flex min-h-8 min-w-0 items-center justify-center gap-1.5 border px-2.5 py-1.5 text-center text-[12px] leading-4 transition",
                active
                  ? "border-ink-800 bg-ink-900 text-paper-50"
                  : "border-ink-200 bg-paper-100 text-ink-600 hover:bg-ink-900/[0.04]",
                disabled && "pointer-events-none opacity-50",
              )}
              onClick={() => onChange(option)}
            >
              {active ? <Check className="h-3.5 w-3.5" /> : null}
              {optionLabel(field, option)}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <select
      value={String(value ?? "")}
      disabled={disabled}
      onChange={(event) => {
        const next = options.find((option) => String(option) === event.currentTarget.value);
        if (next !== undefined) onChange(next);
      }}
      className={inputClassName}
    >
      <option value="" disabled={field.required !== false}>
        {jsonConfigFormMessages.selectPlaceholder()}
      </option>
      {options.map((option) => (
        <option key={String(option)} value={String(option)}>
          {optionLabel(field, option)}
        </option>
      ))}
    </select>
  );
}

export function NumberFieldControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: ConfigFormFieldData;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}): JSX.Element {
  const fieldKey = field.path.join("\u001f");
  const externalValue = typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  const focusedRef = useRef(false);
  const fieldKeyRef = useRef(fieldKey);
  const [draftValue, setDraftValue] = useState(externalValue);

  useEffect(() => {
    if (fieldKeyRef.current !== fieldKey) {
      fieldKeyRef.current = fieldKey;
      setDraftValue(externalValue);
      return;
    }
    if (!focusedRef.current) {
      setDraftValue(externalValue);
    }
  }, [externalValue, fieldKey]);

  const commitDraft = (nextDraft: string): void => {
    const nextValue = readNumberDraftCommitValue(nextDraft);
    if (nextValue !== null) {
      onChange(nextValue);
    }
  };

  return (
    <input
      type="number"
      value={draftValue}
      min={field.min}
      max={field.max}
      step={field.step}
      disabled={disabled}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(event) => {
        const nextDraft = event.currentTarget.value;
        setDraftValue(nextDraft);
        commitDraft(nextDraft);
      }}
      onBlur={() => {
        focusedRef.current = false;
        const blurValue = readNumberDraftBlurValue(draftValue);
        if (blurValue === null) {
          setDraftValue(externalValue);
          return;
        }
        onChange(blurValue);
        setDraftValue(String(blurValue));
      }}
      className={inputClassName}
    />
  );
}

export function TogglePill({
  enabled,
  disabled,
  label,
  onClick,
}: {
  enabled: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-2 px-1.5 text-[12px] transition",
        enabled ? "text-moss-600" : "text-ink-500",
        !disabled && "hover:bg-ink-900/[0.04]",
        disabled && "pointer-events-none opacity-45",
      )}
      aria-label={`${enabled ? jsonConfigFormMessages.off() : jsonConfigFormMessages.on()} ${label}`}
    >
      <span className={cn("relative h-5 w-9 rounded-full transition", enabled ? "bg-moss-500" : "bg-ink-300")}>
        <span
          className={cn(
            "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-paper-50 shadow-sm transition-transform",
            enabled && "translate-x-4",
          )}
        />
      </span>
      <span>{enabled ? jsonConfigFormMessages.enabled() : jsonConfigFormMessages.disabled()}</span>
    </button>
  );
}

export const inputClassName = cn(
  "h-8 w-full min-w-0 border border-ink-200 bg-paper-100 px-2.5 text-[12.5px] text-ink-800",
  "outline-none transition placeholder:text-ink-400",
  "focus:border-accent-border focus:ring-2 focus:ring-accent-focus",
  "disabled:pointer-events-none disabled:opacity-55",
);
