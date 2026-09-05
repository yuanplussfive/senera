import { useEffect, useRef, useState } from "react";
import type { ConfigFormFieldData } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { MenuSelect, Switch } from "../ui";
import { JsonConfigArrayFieldControl } from "./JsonConfigArrayFieldControl";
import { jsonConfigInputClassName } from "./JsonConfigControlStyles";
import { JsonConfigRecordField } from "./JsonConfigRecordField";
import {
  isJsonConfigObject,
  optionLabel,
  readNumberDraftBlurValue,
  readNumberDraftCommitValue,
  sameOptionValue,
} from "./JsonConfigValue";

export function renderJsonConfigFieldInput(
  field: ConfigFormFieldData,
  value: unknown,
  disabled: boolean,
  onChange: (value: unknown) => void,
): JSX.Element {
  if (field.type === "boolean") {
    return (
      <Switch
        checked={Boolean(value)}
        disabled={disabled}
        ariaLabel={field.label}
        onCheckedChange={() => onChange(!value)}
      />
    );
  }
  if (field.type !== "array" && field.type !== "record" && ((field.options?.length ?? 0) > 0 || field.modelSelection)) {
    return <OptionControl field={field} value={value} disabled={disabled} onChange={onChange} />;
  }
  if (field.type === "number") {
    return <NumberFieldControl field={field} value={value} disabled={disabled} onChange={onChange} />;
  }
  if (field.type === "array") {
    return (
      <JsonConfigArrayFieldControl
        field={field}
        value={Array.isArray(value) ? value : []}
        disabled={disabled}
        onChange={onChange}
        renderInput={renderJsonConfigFieldInput}
      />
    );
  }
  if (field.type === "record") {
    return (
      <JsonConfigRecordField
        field={field}
        value={isJsonConfigObject(value) ? value : {}}
        disabled={disabled}
        inputClassName={jsonConfigInputClassName}
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
        className={cn(jsonConfigInputClassName, "min-h-24 resize-y py-2")}
      />
    ) : (
      <input
        type={field.secret ? "password" : "text"}
        value={typeof value === "string" ? value : ""}
        placeholder={field.placeholder}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={jsonConfigInputClassName}
      />
    );
  }
  return (
    <pre className="scrollbar-thin max-h-32 overflow-auto border border-ink-200 bg-paper-50 p-2 font-mono text-[11px] leading-5 text-ink-600">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
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
  if (!field.modelSelection && options.length <= 4) {
    const selectedIndex = options.findIndex((option) => sameOptionValue(value, option));
    return (
      <>
        <MenuSelect
          value={selectedIndex >= 0 ? String(selectedIndex) : ""}
          placeholder={field.placeholder ?? frontendMessage("config.form.selectPlaceholder")}
          options={options.map((option, index) => ({ value: String(index), label: optionLabel(field, option) }))}
          disabled={disabled}
          ariaLabel={field.label}
          triggerClassName={jsonConfigInputClassName}
          onChange={(index) => {
            const option = options[Number(index)];
            if (option !== undefined) onChange(option);
          }}
        />
        {/* Preserve radio semantics for assistive technology while the visible
            control uses the shared menu treatment. */}
        <div className="sr-only">
          {options.map((option, index) => (
            <input
              key={String(index)}
              type="radio"
              name={field.path.join("\u001f")}
              aria-label={optionLabel(field, option)}
              aria-checked={selectedIndex === index}
              checked={selectedIndex === index}
              disabled={disabled}
              onChange={() => onChange(option)}
            />
          ))}
        </div>
      </>
    );
  }
  if (field.modelSelection) {
    const currentValue = String(value ?? "");
    const placeholder = field.placeholder ?? frontendMessage("config.form.selectPlaceholder");
    const menuOptions = [
      ...(!field.required ? [{ value: "", label: placeholder }] : []),
      ...options.map((option) => ({ value: String(option), label: optionLabel(field, option) })),
    ];
    return (
      <>
        <MenuSelect
          value={currentValue}
          placeholder={placeholder}
          options={menuOptions}
          disabled={disabled}
          triggerClassName={jsonConfigInputClassName}
          onChange={(next) => {
            const option = options.find((candidate) => String(candidate) === next);
            if (option !== undefined) {
              onChange(option);
              return;
            }
            if (!field.required && next === "") onChange(undefined);
          }}
        />
        {/* Keep a native combobox in the accessibility tree for platform
            keyboard users while the visible control uses the shared menu. */}
        <select
          value={currentValue}
          disabled={disabled}
          aria-label={field.label}
          className="sr-only"
          onChange={(event) => {
            const option = options.find((candidate) => String(candidate) === event.currentTarget.value);
            if (option !== undefined) {
              onChange(option);
              return;
            }
            if (!field.required && event.currentTarget.value === "") onChange(undefined);
          }}
        >
          <option value="" disabled={field.required !== false}>
            {placeholder}
          </option>
          {options.map((option) => (
            <option key={String(option)} value={String(option)}>
              {optionLabel(field, option)}
            </option>
          ))}
        </select>
      </>
    );
  }
  const selectedIndex = options.findIndex((option) => sameOptionValue(value, option));
  const placeholder = field.placeholder ?? frontendMessage("config.form.selectPlaceholder");
  const optionOffset = field.required ? 0 : 1;
  const menuOptions = [
    ...(!field.required ? [{ value: "", label: placeholder }] : []),
    ...options.map((option, index) => ({ value: String(index + optionOffset), label: optionLabel(field, option) })),
  ];
  return (
    <MenuSelect
      value={selectedIndex >= 0 ? String(selectedIndex + optionOffset) : ""}
      placeholder={placeholder}
      options={menuOptions}
      disabled={disabled}
      ariaLabel={field.label}
      triggerClassName={jsonConfigInputClassName}
      onChange={(index) => {
        if (index === "") {
          onChange(undefined);
          return;
        }
        const option = options[Number(index) - optionOffset];
        if (option !== undefined) onChange(option);
      }}
    />
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
    if (!focusedRef.current) setDraftValue(externalValue);
  }, [externalValue, fieldKey]);

  const commitDraft = (nextDraft: string): void => {
    const nextValue = readNumberDraftCommitValue(nextDraft);
    if (nextValue !== null) onChange(nextValue);
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
      className={jsonConfigInputClassName}
    />
  );
}
