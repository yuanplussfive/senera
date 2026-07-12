import type { ConfigFormFieldData } from "../../api/eventTypes";
import { cn } from "../../lib/util";
import { ArrayFieldControl } from "./JsonConfigArrayFieldControl";
import { JsonConfigRecordField } from "./JsonConfigRecordField";
import { isRecord } from "./jsonConfigFormModel";
import { inputClassName, NumberFieldControl, OptionControl, TogglePill } from "./JsonConfigPrimitiveControls";

export function JsonFieldControl({
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
        renderFieldInput={renderJsonFieldInput}
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
