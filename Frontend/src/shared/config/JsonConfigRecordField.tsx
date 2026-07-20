import { Plus, Trash2 } from "lucide-react";
import type { ConfigFormFieldData, ConfigFormFieldOptionValue } from "../../api/eventTypes";
import { cn } from "../../lib/util";
import { jsonConfigFormMessages } from "./jsonConfigFormMessages";

export interface JsonConfigRecordFieldProps {
  field: ConfigFormFieldData;
  value: Record<string, unknown>;
  disabled: boolean;
  inputClassName: string;
  onChange: (value: Record<string, unknown>) => void;
}

export function JsonConfigRecordField({
  field,
  value,
  disabled,
  inputClassName,
  onChange,
}: JsonConfigRecordFieldProps): JSX.Element {
  const entries = Object.entries(value);
  const updateEntryKey = (index: number, nextKey: string): void => {
    const nextEntries = entries.map((entry, entryIndex) =>
      entryIndex === index ? ([nextKey, entry[1]] as [string, unknown]) : entry,
    );
    onChange(Object.fromEntries(nextEntries.filter(([key]) => key.trim().length > 0)));
  };
  const updateEntryValue = (index: number, nextValue: string): void => {
    const nextEntries = entries.map(([key, entryValue], entryIndex) =>
      entryIndex === index ? [key, coerceRecordItem(nextValue, field.itemType ?? "string")] : [key, entryValue],
    );
    onChange(Object.fromEntries(nextEntries));
  };
  const updateRawEntryValue = (index: number, nextValue: unknown): void => {
    const nextEntries = entries.map(([key, entryValue], entryIndex) =>
      entryIndex === index ? [key, nextValue] : [key, entryValue],
    );
    onChange(Object.fromEntries(nextEntries));
  };

  return (
    <div className="space-y-2">
      {entries.map(([key, entryValue], index) => (
        <div key={`${key}-${index}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
          <input
            value={key}
            placeholder={field.keyPlaceholder}
            disabled={disabled}
            spellCheck={false}
            onChange={(event) => updateEntryKey(index, event.currentTarget.value)}
            className={inputClassName}
          />
          <RecordValueControl
            field={field}
            value={entryValue}
            disabled={disabled}
            inputClassName={inputClassName}
            onChange={(nextValue) => updateRawEntryValue(index, nextValue)}
            onTextChange={(nextValue) => updateEntryValue(index, nextValue)}
          />
          <IconAction
            label={jsonConfigFormMessages.delete()}
            disabled={disabled}
            danger
            onClick={() => onChange(Object.fromEntries(entries.filter((_, itemIndex) => itemIndex !== index)))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </IconAction>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-ink-300 bg-paper-50 px-2.5 text-[12px] text-ink-600 transition hover:border-accent-border-strong hover:text-accent-content-hover disabled:pointer-events-none disabled:opacity-50"
        onClick={() => {
          const nextKey = nextRecordKey(value);
          onChange({
            ...value,
            [nextKey]: defaultRecordItem(field.itemType ?? "string"),
          });
        }}
      >
        <Plus className="h-3.5 w-3.5" />
        {jsonConfigFormMessages.addRecord()}
      </button>
    </div>
  );
}

function RecordValueControl({
  field,
  value,
  disabled,
  inputClassName,
  onChange,
  onTextChange,
}: {
  field: ConfigFormFieldData;
  value: unknown;
  disabled: boolean;
  inputClassName: string;
  onChange: (value: unknown) => void;
  onTextChange: (value: string) => void;
}): JSX.Element {
  const options = field.options ?? [];
  if (options.length > 0) {
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
        <option value="" disabled>
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

  return (
    <input
      type={field.secret ? "password" : field.itemType === "number" ? "number" : "text"}
      value={String(value ?? "")}
      placeholder={field.valuePlaceholder}
      disabled={disabled}
      spellCheck={false}
      onChange={(event) => onTextChange(event.currentTarget.value)}
      className={inputClassName}
    />
  );
}

function IconAction({
  children,
  danger,
  disabled,
  label,
  onClick,
}: {
  children: JSX.Element;
  danger?: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center border border-ink-200 bg-paper-50 text-ink-500 transition disabled:pointer-events-none disabled:opacity-50",
        danger ? "hover:bg-brick-50 hover:text-brick-600" : "hover:bg-ink-900/[0.04] hover:text-ink-800",
      )}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function coerceRecordItem(value: unknown, itemType: string): unknown {
  if (itemType === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (itemType === "boolean") {
    return Boolean(value);
  }
  return String(value ?? "");
}

function defaultRecordItem(itemType: string): unknown {
  if (itemType === "number") {
    return 0;
  }
  if (itemType === "boolean") {
    return false;
  }
  if (itemType === "record" || itemType === "table") {
    return {};
  }
  return "";
}

function nextRecordKey(value: Record<string, unknown>): string {
  const base = "key";
  if (!(base in value)) {
    return base;
  }
  let index = 2;
  while (`${base}${index}` in value) {
    index += 1;
  }
  return `${base}${index}`;
}

function optionLabel(field: ConfigFormFieldData, option: ConfigFormFieldOptionValue): string {
  return field.optionLabels?.[String(option)] ?? String(option);
}
