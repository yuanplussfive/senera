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
    <dl className="mt-4 flex flex-wrap items-center text-[11px]" data-testid={dataTestId}>
      {items.map((item, index) => (
        <div
          key={item.label}
          className={
            index === 0
              ? "inline-flex items-baseline gap-1 pr-3"
              : "inline-flex items-baseline gap-1 border-l border-line px-3"
          }
        >
          <dt className="text-[10px] text-content-muted">{item.label}</dt>
          <dd className="text-[11px] font-semibold tabular-nums text-content-primary">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
