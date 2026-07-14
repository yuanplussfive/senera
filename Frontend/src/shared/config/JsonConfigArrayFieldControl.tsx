import { CopyPlus, Plus, Trash2 } from "lucide-react";
import type { ConfigFormFieldData } from "../../api/eventTypes";
import { cn } from "../../lib/util";
import {
  cloneJsonValue,
  coerceArrayItem,
  defaultArrayItem,
  isRecord,
  normalizeFieldValue,
  readArrayItemTitle,
  readRelativeItemPath,
  readValueAtPath,
  writeJsonConfigFieldValue,
} from "./jsonConfigFormModel";
import { jsonConfigFormMessages } from "./jsonConfigFormMessages";
import { inputClassName } from "./JsonConfigPrimitiveControls";

export type JsonFieldInputRenderer = (
  field: ConfigFormFieldData,
  value: unknown,
  disabled: boolean,
  onChange: (value: unknown) => void,
) => JSX.Element;

export function ArrayFieldControl({
  field,
  value,
  disabled,
  onChange,
  renderFieldInput,
}: {
  field: ConfigFormFieldData;
  value: unknown[];
  disabled: boolean;
  onChange: (value: unknown[]) => void;
  renderFieldInput: JsonFieldInputRenderer;
}): JSX.Element {
  const itemType = field.itemType ?? "string";
  const updateItem = (index: number, nextValue: unknown): void => {
    onChange(value.map((item, itemIndex) => (itemIndex === index ? nextValue : item)));
  };
  const duplicateItem = (index: number): void => {
    const item = value[index];
    onChange([...value.slice(0, index + 1), cloneJsonValue(item), ...value.slice(index + 1)]);
  };

  if (itemType === "table") {
    return (
      <div className="space-y-3">
        {value.map((item, index) => {
          const record = isRecord(item) ? item : {};
          const effectiveItems = Array.isArray(field.effectiveValue) ? field.effectiveValue : [];
          const effectiveRecord = isRecord(effectiveItems[index]) ? effectiveItems[index] : {};
          const titleRecord = { ...effectiveRecord, ...record };
          return (
            <div
              key={`${field.path.join(".")}-${index}`}
              className="overflow-hidden rounded-lg border border-ink-200 bg-paper-50"
            >
              <div className="flex min-w-0 items-center justify-between gap-2 border-b border-ink-200/70 bg-[var(--theme-config-list-bg)] px-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-medium text-ink-900">
                    {readArrayItemTitle(field, titleRecord, index)}
                  </div>
                  <div className="mt-0.5 font-mono text-[10.5px] text-ink-350">#{index + 1}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <IconAction
                    label={jsonConfigFormMessages.copy()}
                    disabled={disabled}
                    onClick={() => duplicateItem(index)}
                  >
                    <CopyPlus className="h-3.5 w-3.5" />
                  </IconAction>
                  <IconAction
                    label={jsonConfigFormMessages.delete()}
                    disabled={disabled}
                    danger
                    onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconAction>
                </div>
              </div>
              <div className="grid min-w-0 gap-px bg-ink-200/60 p-px md:grid-cols-2 xl:grid-cols-3">
                {(field.itemFields ?? []).map((itemField) => {
                  const relativePath = readRelativeItemPath(field.path, itemField.path);
                  const itemValue = readValueAtPath(record, relativePath);
                  const effectiveItemValue = readValueAtPath(effectiveRecord, relativePath);
                  return (
                    <NestedFieldControl
                      key={`${index}-${relativePath.join("\u001f")}`}
                      field={{ ...itemField, path: relativePath }}
                      value={itemValue ?? effectiveItemValue ?? itemField.effectiveValue}
                      disabled={disabled}
                      renderFieldInput={renderFieldInput}
                      onChange={(nextValue) =>
                        updateItem(
                          index,
                          writeJsonConfigFieldValue(record, relativePath, normalizeFieldValue(itemField, nextValue)),
                        )
                      }
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
        <button
          type="button"
          disabled={disabled}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-ink-300 bg-paper-50 px-2.5 text-[12px] text-ink-600 transition hover:border-terra-300 hover:text-terra-700 disabled:pointer-events-none disabled:opacity-50"
          onClick={() => onChange([...value, cloneJsonValue(field.defaultItem ?? {})])}
        >
          <Plus className="h-3.5 w-3.5" />
          {field.addLabel ?? jsonConfigFormMessages.add()}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {value.map((item, index) => (
        <div key={`${field.path.join(".")}-${index}`} className="flex min-w-0 items-center gap-2">
          <input
            type={field.secret ? "password" : itemType === "number" ? "number" : "text"}
            value={String(item ?? "")}
            disabled={disabled}
            spellCheck={false}
            onChange={(event) => updateItem(index, coerceArrayItem(event.currentTarget.value, itemType))}
            className={inputClassName}
          />
          <IconAction
            label={jsonConfigFormMessages.delete()}
            disabled={disabled}
            danger
            onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </IconAction>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled}
        className="inline-flex h-8 items-center gap-1.5 border border-dashed border-ink-300 bg-paper-50 px-2.5 text-[12px] text-ink-600 transition hover:border-terra-300 hover:text-terra-700 disabled:pointer-events-none disabled:opacity-50"
        onClick={() => onChange([...value, defaultArrayItem(itemType)])}
      >
        <Plus className="h-3.5 w-3.5" />
        {field.addLabel ?? jsonConfigFormMessages.add()}
      </button>
    </div>
  );
}

function NestedFieldControl({
  field,
  value,
  disabled,
  onChange,
  renderFieldInput,
}: {
  field: ConfigFormFieldData;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
  renderFieldInput: JsonFieldInputRenderer;
}): JSX.Element {
  return (
    <div className="grid min-w-0 content-start gap-2 bg-paper-50 px-3 py-3">
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-ink-800">{field.label}</div>
        {field.description ? (
          <div className="mt-0.5 text-[11.5px] leading-5 text-ink-500">{field.description}</div>
        ) : null}
      </div>
      <div className="min-w-0">{renderFieldInput(field, value ?? field.defaultValue, disabled, onChange)}</div>
    </div>
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
