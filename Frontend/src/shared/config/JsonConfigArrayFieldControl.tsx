import { CopyPlus, Plus, Trash2 } from "lucide-react";
import type { ConfigFormFieldData } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { jsonConfigInputClassName } from "./JsonConfigControlStyles";
import {
  cloneJsonValue,
  coerceArrayItem,
  defaultArrayItem,
  isJsonConfigObject,
  normalizeJsonConfigFieldValue,
  readArrayItemTitle,
  readRelativeItemPath,
  readValueAtPath,
  writeJsonConfigFieldValue,
} from "./JsonConfigValue";

export function JsonConfigArrayFieldControl({
  field,
  value,
  disabled,
  onChange,
  renderInput,
}: {
  field: ConfigFormFieldData;
  value: unknown[];
  disabled: boolean;
  onChange: (value: unknown[]) => void;
  renderInput: (
    field: ConfigFormFieldData,
    value: unknown,
    disabled: boolean,
    onChange: (value: unknown) => void,
  ) => JSX.Element;
}): JSX.Element {
  const itemType = field.itemType ?? "string";
  const updateItem = (index: number, nextValue: unknown): void => {
    onChange(value.map((item, itemIndex) => (itemIndex === index ? nextValue : item)));
  };
  const duplicateItem = (index: number): void => {
    onChange([...value.slice(0, index + 1), cloneJsonValue(value[index]), ...value.slice(index + 1)]);
  };

  if (itemType === "table") {
    return (
      <div className="space-y-3">
        {value.map((item, index) => {
          const record = isJsonConfigObject(item) ? item : {};
          const effectiveItems = Array.isArray(field.effectiveValue) ? field.effectiveValue : [];
          const effectiveRecord = isJsonConfigObject(effectiveItems[index]) ? effectiveItems[index] : {};
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
                  <JsonConfigIconAction
                    label={frontendMessage("runtime.migrated.shared.config.JsonConfigForm.429.27")}
                    disabled={disabled}
                    onClick={() => duplicateItem(index)}
                  >
                    <CopyPlus className="h-3.5 w-3.5" />
                  </JsonConfigIconAction>
                  <JsonConfigIconAction
                    label={frontendMessage("runtime.migrated.shared.config.JsonConfigForm.436.27")}
                    disabled={disabled}
                    danger
                    onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </JsonConfigIconAction>
                </div>
              </div>
              <div className="grid min-w-0 gap-px bg-ink-200/60 p-px md:grid-cols-2 xl:grid-cols-3">
                {(field.itemFields ?? []).map((itemField) => {
                  const relativePath = readRelativeItemPath(field.path, itemField.path);
                  const itemValue = readValueAtPath(record, relativePath);
                  const effectiveItemValue = readValueAtPath(effectiveRecord, relativePath);
                  return (
                    <NestedJsonConfigFieldControl
                      key={`${index}-${relativePath.join("\u001f")}`}
                      field={{ ...itemField, path: relativePath }}
                      value={itemValue ?? effectiveItemValue ?? itemField.effectiveValue}
                      disabled={disabled}
                      renderInput={renderInput}
                      onChange={(nextValue) =>
                        updateItem(
                          index,
                          writeJsonConfigFieldValue(
                            record,
                            relativePath,
                            normalizeJsonConfigFieldValue(itemField, nextValue),
                          ),
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
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-ink-300 bg-paper-50 px-2.5 text-[12px] text-ink-600 transition hover:border-accent-border-strong hover:text-accent-content-hover disabled:pointer-events-none disabled:opacity-50"
          onClick={() => onChange([...value, cloneJsonValue(field.defaultItem ?? {})])}
        >
          <Plus className="h-3.5 w-3.5" />
          {field.addLabel ?? "添加"}
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
            className={jsonConfigInputClassName}
          />
          <JsonConfigIconAction
            label={frontendMessage("runtime.migrated.shared.config.JsonConfigForm.493.19")}
            disabled={disabled}
            danger
            onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </JsonConfigIconAction>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled}
        className="inline-flex h-8 items-center gap-1.5 border border-dashed border-ink-300 bg-paper-50 px-2.5 text-[12px] text-ink-600 transition hover:border-accent-border-strong hover:text-accent-content-hover disabled:pointer-events-none disabled:opacity-50"
        onClick={() => onChange([...value, defaultArrayItem(itemType)])}
      >
        <Plus className="h-3.5 w-3.5" />
        {field.addLabel ?? "添加"}
      </button>
    </div>
  );
}

function NestedJsonConfigFieldControl({
  field,
  value,
  disabled,
  onChange,
  renderInput,
}: {
  field: ConfigFormFieldData;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
  renderInput: (
    field: ConfigFormFieldData,
    value: unknown,
    disabled: boolean,
    onChange: (value: unknown) => void,
  ) => JSX.Element;
}): JSX.Element {
  return (
    <div className="grid min-w-0 content-start gap-2 bg-paper-50 px-3 py-3">
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-ink-800">{field.label}</div>
        {field.description ? (
          <div className="mt-0.5 text-[11.5px] leading-5 text-ink-500">{field.description}</div>
        ) : null}
      </div>
      <div className="min-w-0">{renderInput(field, value ?? field.defaultValue, disabled, onChange)}</div>
    </div>
  );
}

function JsonConfigIconAction({
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
