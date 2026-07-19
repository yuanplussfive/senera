import { useEffect, useRef, useState } from "react";
import { Check, CopyPlus, Plus, Trash2 } from "lucide-react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { ConfigFormFieldData, ConfigFormFieldOptionValue, ConfigFormSectionData } from "../../api/eventTypes";
import { cn } from "../../lib/util";
import { ScrollArea, Switch } from "../ui";
import { JsonConfigRecordField } from "./JsonConfigRecordField";

export type JsonConfigObject = Record<string, unknown>;

export function JsonConfigSettingsView({
  layoutMode = "panel",
  sections,
  showSectionHeading = true,
  value,
  disabled,
  emptyText = "没有可视化配置项",
  onChange,
  onCommit,
}: {
  layoutMode?: "panel" | "embedded";
  sections: ConfigFormSectionData[];
  showSectionHeading?: boolean;
  value: JsonConfigObject;
  disabled?: boolean;
  emptyText?: string;
  onChange: (value: JsonConfigObject, mode?: "debounced" | "immediate") => void;
  onCommit?: () => void;
}): JSX.Element {
  const visibleSections = sections.filter((section) => section.fields.length > 0);

  const content = (
    <div
      onBlurCapture={onCommit}
      className={cn("mx-auto w-full max-w-[1180px] px-4 py-5 sm:px-6 sm:py-7", layoutMode === "panel" && "min-h-full")}
    >
      {visibleSections.length > 0 ? (
        <>
          {visibleSections.length > 1 ? (
            <nav
              aria-label={frontendMessage("settings.config.sectionNavigation")}
              className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink-200/70 pb-2"
            >
              <span className="text-[11px] font-medium text-ink-450">
                {frontendMessage("settings.config.sectionNavigation")}:
              </span>
              {visibleSections.map((section) => (
                <a
                  key={section.name}
                  href={"#" + jsonSectionAnchorId(section.name)}
                  className="text-[11.5px] text-content-secondary underline decoration-ink-300 underline-offset-2 transition hover:text-content-primary"
                >
                  {section.label}
                </a>
              ))}
            </nav>
          ) : null}
          <div className="space-y-7">
            {visibleSections.map((section) => (
              <JsonSettingsSection
                key={section.name}
                section={section}
                showHeading={showSectionHeading}
                value={value}
                disabled={Boolean(disabled)}
                onUpdateField={(field, nextValue) =>
                  onChange(
                    writeJsonConfigFieldValue(value, field.path, normalizeFieldValue(field, nextValue)),
                    field.type === "boolean" || Boolean(field.options?.length) ? "immediate" : "debounced",
                  )
                }
            />
          ))}
          </div>
        </>
      ) : (
        <div className="grid min-h-64 place-items-center border-y border-ink-200/70 bg-paper-50 text-[13px] text-ink-400">
          {emptyText}
        </div>
      )}
    </div>
  );

  if (layoutMode === "embedded") {
    return <div className="bg-paper-50">{content}</div>;
  }

  return (
    <ScrollArea className="h-full min-h-0 flex-1 bg-paper-50" viewportClassName="h-full">
      {content}
    </ScrollArea>
  );
}

function JsonSettingsSection({
  section,
  showHeading,
  value,
  disabled,
  onUpdateField,
}: {
  section: ConfigFormSectionData;
  showHeading: boolean;
  value: JsonConfigObject;
  disabled: boolean;
  onUpdateField: (field: ConfigFormFieldData, value: unknown) => void;
}): JSX.Element {
  return (
    <section id={jsonSectionAnchorId(section.name)} className="scroll-mt-3">
      {showHeading ? (
        <div className="mb-2 min-w-0 px-0.5">
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-ink-900">{section.label}</h3>
            {section.description ? (
              <p className="mt-0.5 text-[12px] leading-5 text-ink-500">{section.description}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="border-y border-ink-200/70 bg-paper-100">
        {section.fields.map((field) => (
          <JsonFieldControl
            key={field.path.join("\u001f")}
            field={field}
            value={readDraftOrEffectiveValue(value, field)}
            disabled={disabled}
            onChange={(nextValue) => onUpdateField(field, nextValue)}
          />
        ))}
      </div>
    </section>
  );
}


function jsonSectionAnchorId(name: string): string {
  return "json-config-section-" + name.replace(/[^A-Za-z0-9_-]+/g, "-");
}
function JsonFieldControl({
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
  const wide = isWideField(field);

  return (
    <div
      className={cn(
        "grid min-w-0 gap-3 border-t border-ink-200/65 px-4 py-3.5 first:border-t-0 md:grid-cols-[minmax(220px,1fr)_minmax(290px,420px)]",
        field.type === "array" || field.type === "record" ? "md:items-start" : "md:items-center",
        wide && "md:grid-cols-1 md:gap-3 md:px-4 md:py-4",
      )}
    >
      <div className={cn("min-w-0 pr-2", wide && "pr-0")}>
        <div className={cn("text-[13px] font-medium text-ink-900", wide && "text-[13.5px]")}>{field.label}</div>
        {field.description ? <p className="mt-1 text-[12px] leading-5 text-ink-500">{field.description}</p> : null}
      </div>
      <div className={cn("min-w-0 md:justify-self-end", wide && "md:w-full md:justify-self-stretch")}>
        {renderJsonFieldInput(field, value ?? field.defaultValue, disabled, onChange)}
      </div>
    </div>
  );
}

function readDraftOrEffectiveValue(value: JsonConfigObject, field: ConfigFormFieldData): unknown {
  const draftValue = readValueAtPath(value, field.path);
  return draftValue === undefined ? field.effectiveValue : draftValue;
}

function renderJsonFieldInput(
  field: ConfigFormFieldData,
  value: unknown,
  disabled: boolean,
  onChange: (value: unknown) => void,
): JSX.Element {
  if (field.type === "boolean") {
    return (
      <TogglePill enabled={Boolean(value)} disabled={disabled} label={field.label} onClick={() => onChange(!value)} />
    );
  }

  if (field.type !== "record" && field.options && field.options.length > 0) {
    return <OptionControl field={field} value={value} disabled={disabled} onChange={onChange} />;
  }

  if (field.type === "number") {
    return <NumberFieldControl field={field} value={value} disabled={disabled} onChange={onChange} />;
  }

  if (field.type === "array") {
    return (
      <ArrayFieldControl
        field={field}
        value={Array.isArray(value) ? value : []}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  if (field.type === "record") {
    return (
      <JsonConfigRecordField
        field={field}
        value={isRecord(value) ? value : {}}
        disabled={disabled}
        inputClassName={inputClassName}
        onChange={onChange}
      />
    );
  }

  if (field.type === "string") {
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

  return (
    <pre className="max-h-32 overflow-auto border border-ink-200 bg-paper-50 p-2 font-mono text-[11px] leading-5 text-ink-600">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function isWideField(field: ConfigFormFieldData): boolean {
  return field.type === "array" && field.itemType === "table";
}

function OptionControl({
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
        {frontendMessage("runtime.migrated.shared.config.JsonConfigForm.310.60")}
      </option>
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

function ArrayFieldControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: ConfigFormFieldData;
  value: unknown[];
  disabled: boolean;
  onChange: (value: unknown[]) => void;
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
                    label={frontendMessage("runtime.migrated.shared.config.JsonConfigForm.429.27")}
                    disabled={disabled}
                    onClick={() => duplicateItem(index)}
                  >
                    <CopyPlus className="h-3.5 w-3.5" />
                  </IconAction>
                  <IconAction
                    label={frontendMessage("runtime.migrated.shared.config.JsonConfigForm.436.27")}
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
            className={inputClassName}
          />
          <IconAction
            label={frontendMessage("runtime.migrated.shared.config.JsonConfigForm.493.19")}
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
        className="inline-flex h-8 items-center gap-1.5 border border-dashed border-ink-300 bg-paper-50 px-2.5 text-[12px] text-ink-600 transition hover:border-accent-border-strong hover:text-accent-content-hover disabled:pointer-events-none disabled:opacity-50"
        onClick={() => onChange([...value, defaultArrayItem(itemType)])}
      >
        <Plus className="h-3.5 w-3.5" />
        {field.addLabel ?? "添加"}
      </button>
    </div>
  );
}

function NestedFieldControl({
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
  return (
    <div className="grid min-w-0 content-start gap-2 bg-paper-50 px-3 py-3">
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-ink-800">{field.label}</div>
        {field.description ? (
          <div className="mt-0.5 text-[11.5px] leading-5 text-ink-500">{field.description}</div>
        ) : null}
      </div>
      <div className="min-w-0">{renderJsonFieldInput(field, value ?? field.defaultValue, disabled, onChange)}</div>
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

export function writeJsonConfigFieldValue(
  document: JsonConfigObject,
  pathParts: readonly string[],
  value: unknown,
): JsonConfigObject {
  const clone = cloneJsonValue(document) as JsonConfigObject;
  setValueAtPath(clone, pathParts, value);
  return clone;
}

export function validateJsonConfigDraft(sections: readonly ConfigFormSectionData[], value: JsonConfigObject): string[] {
  return sections.flatMap((section) =>
    section.fields.flatMap((field) => validateJsonConfigField(field, readDraftOrEffectiveValue(value, field))),
  );
}

function validateJsonConfigField(field: ConfigFormFieldData, value: unknown): string[] {
  const label = field.label;
  if (value === undefined) {
    return field.required === false ? [] : [`${label} 缺少必填配置`];
  }

  const errors: string[] = [];
  if (field.type === "boolean" && typeof value !== "boolean") {
    errors.push(`${label} 必须是布尔值`);
  }
  if (field.type === "string") {
    if (typeof value !== "string") {
      errors.push(`${label} 必须是字符串`);
    } else {
      errors.push(...validateStringField(field, value, label));
    }
  }
  if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`${label} 必须是数字`);
    } else {
      errors.push(...validateNumberField(field, value, label));
    }
  }
  if (field.type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${label} 必须是数组`);
    } else {
      value.forEach((item, index) => {
        errors.push(...validateArrayItem(field, item, index, label));
      });
    }
  }
  if ((field.type === "table" || field.type === "record") && !isRecord(value)) {
    errors.push(`${label} 必须是对象`);
  }
  if (field.options && field.options.length > 0) {
    const values = field.type === "array" && Array.isArray(value) ? value : [value];
    const checkedValues = field.type === "record" && isRecord(value) ? Object.values(value) : values;
    checkedValues.forEach((item, index) => {
      if (!field.options?.some((option) => sameOptionValue(item, option))) {
        const suffix = checkedValues.length > 1 ? ` 第 ${index + 1} 项` : "";
        errors.push(`${label}${suffix} 必须是允许的选项`);
      }
    });
  }
  return errors;
}

function validateNumberField(field: ConfigFormFieldData, value: number, label: string): string[] {
  const errors: string[] = [];
  if (typeof field.min === "number" && value < field.min) {
    errors.push(`${label} 不能小于 ${field.min}`);
  }
  if (typeof field.max === "number" && value > field.max) {
    errors.push(`${label} 不能大于 ${field.max}`);
  }
  return errors;
}

function validateStringField(field: ConfigFormFieldData, value: string, label: string): string[] {
  const length = value.trim().length;
  const errors: string[] = [];
  if ((field.required !== false || typeof field.minLength === "number") && length === 0) {
    errors.push(`${label} 不能为空`);
    return errors;
  }
  if (typeof field.minLength === "number" && length < field.minLength) {
    errors.push(`${label} 长度不能小于 ${field.minLength}`);
  }
  if (typeof field.maxLength === "number" && length > field.maxLength) {
    errors.push(`${label} 长度不能大于 ${field.maxLength}`);
  }
  return errors;
}

function validateArrayItem(field: ConfigFormFieldData, value: unknown, index: number, label: string): string[] {
  const itemLabel = `${label} 第 ${index + 1} 项`;
  const itemType = field.itemType ?? "string";
  if (itemType === "table") {
    if (!isRecord(value)) {
      return [`${itemLabel} 必须是对象`];
    }
    const effectiveItems = Array.isArray(field.effectiveValue) ? field.effectiveValue : [];
    const effectiveItem = isRecord(effectiveItems[index]) ? effectiveItems[index] : {};
    return (field.itemFields ?? []).flatMap((itemField) => {
      const relativePath = readRelativeItemPath(field.path, itemField.path);
      return validateJsonConfigField(
        itemField,
        readValueAtPath(value, relativePath) ??
          readValueAtPath(effectiveItem, relativePath) ??
          itemField.effectiveValue,
      );
    });
  }
  if (itemType === "boolean" && typeof value !== "boolean") {
    return [`${itemLabel} 必须是布尔值`];
  }
  if (itemType === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return [`${itemLabel} 必须是数字`];
    }
    return validateNumberField(field, value, itemLabel);
  }
  if (itemType === "string") {
    if (typeof value !== "string") {
      return [`${itemLabel} 必须是字符串`];
    }
    return validateStringField(field, value, itemLabel);
  }
  return [];
}

function normalizeFieldValue(field: ConfigFormFieldData, value: unknown): unknown {
  if (field.type === "boolean") {
    return Boolean(value);
  }
  if (field.type === "number") {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }
  if (field.type === "array") {
    return Array.isArray(value)
      ? value.map((item) =>
          field.itemType === "table" ? (isRecord(item) ? item : {}) : coerceArrayItem(item, field.itemType ?? "string"),
        )
      : [];
  }
  if (field.type === "record") {
    return isRecord(value) ? value : {};
  }
  if (field.type === "string") {
    return String(value ?? "");
  }
  return value;
}

function setValueAtPath(document: JsonConfigObject, pathParts: readonly string[], value: unknown): void {
  const lastKey = pathParts[pathParts.length - 1];
  if (!lastKey) {
    return;
  }

  let current: JsonConfigObject = document;
  for (const part of pathParts.slice(0, -1)) {
    const next = current[part];
    if (!isRecord(next)) {
      current[part] = {};
    }
    current = current[part] as JsonConfigObject;
  }
  current[lastKey] = value;
}

function readValueAtPath(source: unknown, pathParts: readonly string[]): unknown {
  let current = source;
  for (const part of pathParts) {
    current = isRecord(current) ? current[part] : undefined;
  }
  return current;
}

function readRelativeItemPath(parentPath: readonly string[], childPath: readonly string[]): string[] {
  return childPath.slice(parentPath.length);
}

function readArrayItemTitle(field: ConfigFormFieldData, record: Record<string, unknown>, index: number): string {
  const title = field.itemLabelPath ? readValueAtPath(record, field.itemLabelPath) : undefined;
  if (typeof title === "string" && title.trim()) {
    return title;
  }
  const id = readValueAtPath(record, ["Id"]);
  if (typeof id === "string" && id.trim()) {
    return id;
  }
  return `${field.label} ${index + 1}`;
}

function coerceArrayItem(value: unknown, itemType: string): unknown {
  if (itemType === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (itemType === "boolean") {
    return Boolean(value);
  }
  return String(value ?? "");
}

function defaultArrayItem(itemType: string): unknown {
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

function optionLabel(field: ConfigFormFieldData, option: ConfigFormFieldOptionValue): string {
  return field.optionLabels?.[String(option)] ?? String(option);
}

function sameOptionValue(left: unknown, right: ConfigFormFieldOptionValue): boolean {
  return String(left) === String(right);
}

function readNumberDraftCommitValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || isIncompleteNumberDraft(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function readNumberDraftBlurValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-" || trimmed === "+") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function isIncompleteNumberDraft(value: string): boolean {
  return value === "-" || value === "+" || value.endsWith(".") || /[eE][+-]?$/.test(value);
}

function cloneJsonValue(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isRecord(value: unknown): value is JsonConfigObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
    <Switch
      checked={enabled}
      disabled={disabled}
      ariaLabel={label}
      onCheckedChange={() => onClick()}
    />
  );
}
const inputClassName = cn(
  "h-8 w-full min-w-0 border border-ink-200 bg-paper-100 px-2.5 text-[12.5px] text-ink-800",
  "outline-none transition placeholder:text-ink-400",
  "focus:border-accent-border focus:ring-2 focus:ring-accent-focus",
  "disabled:pointer-events-none disabled:opacity-55",
);
