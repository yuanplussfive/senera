import { useEffect, useRef, useState } from "react";
import {
  AgentDisplayDurationUnits,
  chooseAgentDisplayDurationUnit,
  convertAgentDuration,
  type AgentDurationUnit,
  type AgentDisplayDurationUnit,
} from "../../../../Source/AgentSystem/Types/AgentDurationUnits";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Input } from "./Form";
import { MenuSelect } from "./MenuSelect";

export interface DurationInputProps {
  value: number | undefined;
  storageUnit: AgentDurationUnit;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (value: number | undefined) => void;
  onBlur?: () => void;
}

export function DurationInput({
  value,
  storageUnit,
  min,
  max,
  step,
  disabled,
  ariaLabel,
  onChange,
  onBlur,
}: DurationInputProps): JSX.Element {
  const [unit, setUnit] = useState(() => chooseAgentDisplayDurationUnit(value, storageUnit));
  const display = value === undefined ? "" : String(convertAgentDuration(value, storageUnit, unit));
  const [draft, setDraft] = useState(display);
  const focused = useRef(false);
  const edited = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(display);
  }, [display]);
  const convertBound = (bound: number | undefined): number | undefined =>
    bound === undefined ? undefined : convertAgentDuration(bound, storageUnit, unit);
  const commit = (text: string): void => {
    if (text === "") {
      onChange(undefined);
      return;
    }
    const number = Number(text);
    if (!Number.isFinite(number)) return;
    const raw = convertAgentDuration(number, unit, storageUnit);
    if (raw === value) return;
    if ((min !== undefined && raw < min) || (max !== undefined && raw > max)) return;
    onChange(raw);
  };
  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <Input
        type="number"
        size="sm"
        className="min-w-0 flex-1 tabular-nums"
        value={draft}
        disabled={disabled}
        aria-label={ariaLabel}
        min={convertBound(min)}
        max={convertBound(max)}
        step={step === undefined ? "any" : convertBound(step)}
        onFocus={() => {
          focused.current = true;
          edited.current = false;
        }}
        onChange={(event) => {
          edited.current = true;
          setDraft(event.currentTarget.value);
          commit(event.currentTarget.value);
        }}
        onBlur={() => {
          focused.current = false;
          if (edited.current) commit(draft);
          edited.current = false;
          setDraft(display);
          onBlur?.();
        }}
      />
      <MenuSelect
        size="md"
        value={unit}
        placeholder={frontendMessage("settings.duration.unit")}
        ariaLabel={`${ariaLabel}: ${frontendMessage("settings.duration.unit")}`}
        disabled={disabled}
        triggerClassName="w-20 shrink-0 text-[13px]"
        options={AgentDisplayDurationUnits.map((value) => ({
          value,
          label: frontendMessage(`settings.duration.${value}`),
        }))}
        onChange={(next) => {
          const nextUnit = next as AgentDisplayDurationUnit;
          setUnit(nextUnit);
          setDraft(value === undefined ? "" : String(convertAgentDuration(value, storageUnit, nextUnit)));
        }}
      />
    </div>
  );
}
