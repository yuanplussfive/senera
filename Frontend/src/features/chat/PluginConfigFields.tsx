import { useEffect, useRef, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import type { PluginConfigField } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import {
  coerceArrayItem,
  defaultArrayItem,
  optionLabel,
  readNumberDraftBlurValue,
  readNumberDraftCommitValue,
  sameOptionValue,
  settingLabel,
} from "./pluginConfigDraft";

export function FieldControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: PluginConfigField;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}): JSX.Element {
  return (
    <div
      className={cn(
        "grid min-w-0 gap-3 px-4 py-3.5 transition hover:bg-paper-100/45 md:grid-cols-[minmax(220px,1fr)_minmax(250px,320px)]",
        field.type === "array" ? "md:items-start" : "md:items-center",
      )}
    >
      <div className="min-w-0 pr-2">
        <div className="text-[13px] font-medium text-ink-900">{field.label}</div>
        {field.description ? <p className="mt-1 text-[12px] leading-5 text-ink-500">{field.description}</p> : null}
      </div>
      <div className="min-w-0 md:justify-self-end">{renderFieldInput(field, value, disabled, onChange)}</div>
    </div>
  );
}

export const inputClassName = cn(
  "h-8 w-full rounded-lg border border-ink-200 bg-paper-100 px-2.5 text-[12.5px] text-ink-800",
  "outline-none transition placeholder:text-ink-400",
  "focus:border-accent-border focus:ring-2 focus:ring-accent-focus",
  "disabled:pointer-events-none disabled:opacity-55",
);

function renderFieldInput(
  field: PluginConfigField,
  value: unknown,
  disabled: boolean,
  onChange: (value: unknown) => void,
): JSX.Element {
  const controls = {
    boolean: () => (
      <TogglePill
        enabled={Boolean(value)}
        disabled={disabled}
        label={settingLabel(field)}
        onClick={() => onChange(!value)}
      />
    ),
    number: () => <NumberFieldControl field={field} value={value} disabled={disabled} onChange={onChange} />,
    array: () => (
      <ArrayFieldControl
        field={field}
        value={Array.isArray(value) ? value : []}
        disabled={disabled}
        onChange={onChange}
      />
    ),
    string: () => <StringFieldControl field={field} value={value} disabled={disabled} onChange={onChange} />,
    table: () => (
      <pre className="max-h-32 overflow-auto rounded-md border border-ink-200 bg-paper-50 p-2 font-mono text-[11px] leading-5 text-ink-600">
        {JSON.stringify(value, null, 2)}
      </pre>
    ),
  } satisfies Record<PluginConfigField["type"], () => JSX.Element>;

  if (field.options && field.options.length > 0) {
    return <OptionControl field={field} value={value} disabled={disabled} onChange={onChange} />;
  }

  return controls[field.type]();
}

function StringFieldControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: PluginConfigField;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}): JSX.Element {
  return field.multiline ? (
    <textarea
      value={typeof value === "string" ? value : ""}
      placeholder={field.placeholder}
      disabled={disabled}
      spellCheck={false}
      onChange={(event) => onChange(event.currentTarget.value)}
      className={cn(inputClassName, "min-h-24 resize-y py-2")}
    />
  ) : (
    <input
      type={field.secret ? "password" : "text"}
      value={typeof value === "string" ? value : ""}
      placeholder={field.placeholder}
      disabled={disabled}
      spellCheck={false}
      onChange={(event) => onChange(event.currentTarget.value)}
      className={inputClassName}
    />
  );
}

function OptionControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: PluginConfigField;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}): JSX.Element {
  const options = field.options ?? [];
  if (options.length <= 4) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = sameOptionValue(value, option);
          return (
            <button
              key={String(option)}
              type="button"
              disabled={disabled}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] transition",
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
      {options.map((option) => (
        <option key={String(option)} value={String(option)}>
          {optionLabel(field, option)}
        </option>
      ))}
    </select>
  );
}

function NumberFieldControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: PluginConfigField;
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

  const commitDraft = (nextDraft: string): boolean => {
    const nextValue = readNumberDraftCommitValue(nextDraft);
    if (nextValue === null) return false;
    onChange(nextValue);
    return true;
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

function ArrayFieldControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: PluginConfigField;
  value: unknown[];
  disabled: boolean;
  onChange: (value: unknown[]) => void;
}): JSX.Element {
  const itemType = field.itemType ?? "string";
  const updateItem = (index: number, nextValue: unknown): void => {
    onChange(value.map((item, itemIndex) => (itemIndex === index ? nextValue : item)));
  };

  return (
    <div className="space-y-2">
      {value.map((item, index) => (
        <div key={`${field.key}-${index}`} className="flex min-w-0 items-center gap-2">
          <input
            type={field.secret ? "password" : itemType === "number" ? "number" : "text"}
            value={String(item ?? "")}
            disabled={disabled}
            spellCheck={false}
            onChange={(event) => updateItem(index, coerceArrayItem(event.currentTarget.value, itemType))}
            className={inputClassName}
          />
          <button
            type="button"
            disabled={disabled}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-ink-200 bg-paper-50 text-ink-500 transition hover:bg-brick-50 hover:text-brick-600 disabled:pointer-events-none disabled:opacity-50"
            aria-label={frontendMessage("pluginConfig.deleteArrayItem")}
            onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-ink-300 bg-paper-50 px-2.5 text-[12px] text-ink-600 transition hover:border-accent-border-strong hover:text-accent-content-hover disabled:pointer-events-none disabled:opacity-50"
        onClick={() => onChange([...value, defaultArrayItem(itemType)])}
      >
        <Plus className="h-3.5 w-3.5" />
        {frontendMessage("pluginConfig.addArrayItem")}
      </button>
    </div>
  );
}

function TogglePill({
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
        "inline-flex h-8 shrink-0 items-center gap-2 rounded-md px-1.5 text-[12px] transition",
        enabled ? "text-moss-600" : "text-ink-500",
        !disabled && "hover:bg-ink-900/[0.04]",
        disabled && "pointer-events-none opacity-45",
      )}
      aria-label={frontendMessage(enabled ? "pluginConfig.disableLabel" : "pluginConfig.enableLabel", { label })}
    >
      <span className={cn("relative h-5 w-9 rounded-full transition", enabled ? "bg-moss-500" : "bg-ink-300")}>
        <span
          className={cn(
            "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-paper-50 shadow-sm transition-transform",
            enabled && "translate-x-4",
          )}
        />
      </span>
      <span>{frontendMessage(enabled ? "pluginConfig.enabled" : "pluginConfig.disabled")}</span>
    </button>
  );
}
