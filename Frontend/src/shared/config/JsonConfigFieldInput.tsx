import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { ConfigFormFieldData } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { Switch } from "../ui";
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
  if (field.type !== "record" && field.options && field.options.length > 0) {
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
    <pre className="max-h-32 overflow-auto border border-ink-200 bg-paper-50 p-2 font-mono text-[11px] leading-5 text-ink-600">
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
      className={jsonConfigInputClassName}
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
