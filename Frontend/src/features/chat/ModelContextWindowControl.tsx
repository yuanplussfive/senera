import { useId } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { frontendModelConfigMessage } from "../../i18n/frontendModelConfigMessageCatalog";
import { Input } from "../../shared/ui";
import { SettingRow } from "./ModelConfigPrimitives";

const tokenFormatter = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const rulerTicks = Array.from({ length: 21 }, (_, index) => index);

/** Compares declared capacities without inventing a provider limit or restricting custom values. */
export function ModelContextWindowControl({
  value,
  reference,
  disabled,
  onChange,
}: {
  value?: number;
  reference?: number;
  disabled: boolean;
  onChange: (value: number | undefined) => void;
}): JSX.Element {
  const label = frontendMessage("config.model.contextWindow");
  const referenceId = useId();
  const capacity = positiveCapacity(value);
  const catalogCapacity = positiveCapacity(reference);
  const scale = Math.max(capacity ?? 0, catalogCapacity ?? 0);
  return (
    <SettingRow label={label} description={frontendMessage("config.model.contextWindowHint")}>
      <div className="w-full min-w-0 space-y-3" data-model-context-window>
        <div className="relative">
          <Input
            type="number"
            size="sm"
            min={1}
            step={1}
            value={value ?? ""}
            disabled={disabled}
            aria-label={label}
            aria-describedby={catalogCapacity ? referenceId : undefined}
            className="h-8 pr-16 text-[12.5px] tabular-nums"
            placeholder={frontendModelConfigMessage("config.model.contextUnknown")}
            onChange={(event) =>
              onChange(event.currentTarget.value === "" ? undefined : event.currentTarget.valueAsNumber)
            }
            onBlur={() => {
              if (value !== undefined && capacity === undefined) onChange(undefined);
              else if (capacity !== undefined && !Number.isInteger(capacity)) onChange(Math.round(capacity));
            }}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] text-content-muted">
            tokens
          </span>
        </div>
        {scale > 0 ? (
          <div aria-hidden="true" data-context-capacity-ruler>
            <div className="relative h-5 overflow-hidden rounded bg-surface-subtle">
              {capacity ? (
                <div
                  className="absolute inset-y-0 left-0 min-w-1 rounded bg-content-primary/15"
                  style={{ width: `${(capacity / scale) * 100}%` }}
                >
                  <span className="absolute inset-y-1 right-1 w-0.5 rounded-full bg-content-secondary" />
                </div>
              ) : null}
            </div>
            <div className="mt-1.5 flex items-start justify-between text-content-disabled">
              {rulerTicks.map((tick) => (
                <span key={tick} className={tick % 5 === 0 ? "h-2 w-px bg-line-strong" : "h-1 w-px bg-line-subtle"} />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] tabular-nums text-content-muted">
              <span>0</span>
              <span>{tokenFormatter.format(scale / 2)}</span>
              <span>{tokenFormatter.format(scale)}</span>
            </div>
          </div>
        ) : null}
        {catalogCapacity ? (
          <p id={referenceId} className="text-[11px] leading-4 text-content-muted">
            {frontendModelConfigMessage("config.model.contextReference", { tokens: catalogCapacity.toLocaleString() })}
          </p>
        ) : null}
      </div>
    </SettingRow>
  );
}

function positiveCapacity(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? value : undefined;
}
