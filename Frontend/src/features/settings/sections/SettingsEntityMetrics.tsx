import type { ReactNode } from "react";

export interface SettingsEntityMetric {
  readonly label: string;
  readonly value: ReactNode;
}

/** Compact facts for an entity detail header, without creating a separate panel. */
export function SettingsEntityMetrics({
  items,
  dataTestId,
}: {
  items: readonly SettingsEntityMetric[];
  dataTestId?: string;
}): JSX.Element {
  return (
    <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px]" data-testid={dataTestId}>
      {items.map((item) => (
        <div key={item.label} className="inline-flex items-baseline gap-1.5">
          <dt className="text-[10px] text-content-muted">{item.label}</dt>
          <dd className="text-[11px] font-semibold tabular-nums text-content-primary">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
