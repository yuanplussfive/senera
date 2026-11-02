import type { ConfigFormFieldData, ConfigFormFieldOptionValue } from "../../api/eventTypes";
import { cn } from "../../lib/util";
import { AppIcon, MenuSelect, SecretInput } from "../ui";
import { jsonConfigFormMessages } from "./jsonConfigFormMessages";
import { sameOptionValue } from "./JsonConfigValue";
import {
  isJsonConfigObject,
  readRelativeItemPath,
  readValueAtPath,
  writeJsonConfigFieldValue,
} from "./JsonConfigValue";

export interface JsonConfigRecordFieldProps {
  field: ConfigFormFieldData;
  value: Record<string, unknown>;
  disabled: boolean;
  inputClassName: string;
  onChange: (value: Record<string, unknown>) => void;
  renderInput?: (
    field: ConfigFormFieldData,
    value: unknown,
    disabled: boolean,
    onChange: (value: unknown) => void,
  ) => JSX.Element;
}

export function JsonConfigRecordField({
  field,
  value,
  disabled,
  inputClassName,
  onChange,
  renderInput,
}: JsonConfigRecordFieldProps): JSX.Element {
  const entries = Object.entries(value);
  const updateEntryKey = (index: number, nextKey: string): void => {
    if (entries.some(([key], itemIndex) => itemIndex !== index && key === nextKey)) return;
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
        <div
          key={index}
          className={cn(
            "grid min-w-0 gap-2",
            field.itemFields?.length
              ? "grid-cols-[minmax(0,1fr)_auto]"
              : "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]",
          )}
        >
          <input
            value={key}
            placeholder={field.keyPlaceholder}
            disabled={disabled}
            spellCheck={false}
            onChange={(event) => updateEntryKey(index, event.currentTarget.value)}
            className={inputClassName}
          />
          {!field.itemFields?.length ? (
            <RecordValueControl
              field={field}
              value={entryValue}
              disabled={disabled}
              inputClassName={inputClassName}
              onChange={(nextValue) => updateRawEntryValue(index, nextValue)}
              onTextChange={(nextValue) => updateEntryValue(index, nextValue)}
            />
          ) : null}
          <IconAction
            label={jsonConfigFormMessages.delete()}
            disabled={disabled}
            danger
            onClick={() => onChange(Object.fromEntries(entries.filter((_, itemIndex) => itemIndex !== index)))}
          >
            <AppIcon icon="trash" size={14} />
          </IconAction>
          {field.itemFields?.length && renderInput ? (
            <div className="col-span-full grid min-w-0 gap-3 border-l border-line pl-3 md:grid-cols-2">
              {field.itemFields.map((itemField) => {
                const relativePath = readRelativeItemPath(field.path, itemField.path);
                const record = isJsonConfigObject(entryValue) ? entryValue : {};
                const effectiveRecord =
                  isJsonConfigObject(field.effectiveValue) && isJsonConfigObject(field.effectiveValue[key])
                    ? field.effectiveValue[key]
                    : {};
                const itemValue =
                  readValueAtPath(record, relativePath) ??
                  readValueAtPath(effectiveRecord, relativePath) ??
                  itemField.defaultValue;
                return (
                  <div key={relativePath.join(".")} className="min-w-0 space-y-1.5">
                    <div className="text-[12px] text-content-secondary">{itemField.label}</div>
                    {renderInput(
                      { ...itemField, path: [...field.path, key, ...relativePath] },
                      itemValue,
                      disabled,
                      (nextValue) =>
                        updateRawEntryValue(
                          index,
                          writeJsonConfigFieldValue(
                            record,
                            relativePath,
                            itemField.type === "string" && !itemField.required && nextValue === ""
                              ? undefined
                              : nextValue,
                          ),
                        ),
                    )}
                    {itemField.description ? (
                      <p className="text-[11px] leading-4 text-content-muted">{itemField.description}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
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
            [nextKey]: field.itemFields?.length
              ? structuredClone(field.defaultItem ?? {})
              : defaultRecordItem(field.itemType ?? "string"),
          });
        }}
      >
        <AppIcon icon="plus" size={14} />
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
  if (field.secret)
    return (
      <SecretInput
        value={String(value ?? "")}
        placeholder={field.valuePlaceholder}
        ariaLabel={field.label}
        disabled={disabled}
        onChange={onTextChange}
      />
    );
  const options = field.options ?? [];
  if (options.length > 0) {
    const selectedIndex = options.findIndex((option) => sameOptionValue(value, option));
    return (
      <MenuSelect
        value={selectedIndex >= 0 ? String(selectedIndex) : ""}
        placeholder={jsonConfigFormMessages.selectPlaceholder()}
        options={options.map((option, index) => ({ value: String(index), label: optionLabel(field, option) }))}
        disabled={disabled}
        ariaLabel={field.label}
        triggerClassName={inputClassName}
        onChange={(index) => {
          const next = options[Number(index)];
          if (next !== undefined) onChange(next);
        }}
      />
    );
  }

  return (
    <input
      type={field.itemType === "number" ? "number" : "text"}
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
        "grid h-9 w-9 shrink-0 place-items-center rounded-md border border-ink-200 bg-paper-50 text-ink-500 transition disabled:pointer-events-none disabled:opacity-50",
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
