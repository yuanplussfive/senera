import type { ReactNode } from "react";

/** Shared card and chart primitives for the insights surfaces. */
export function InsightsSectionTitle({
  title,
  note,
  count,
  countLabel,
}: {
  title: ReactNode;
  note?: ReactNode;
  count?: number;
  countLabel?: string;
}): JSX.Element {
  return (
    <div className="insights-section-title">
      <h3>
        {title}
        {count !== undefined ? (
          <span className="insights-count" title={countLabel} aria-label={countLabel}>
            {count}
          </span>
        ) : null}
      </h3>
      {note ? <span>{note}</span> : null}
    </div>
  );
}

export function InsightsMetric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dd>{value}</dd>
      <dt>{label}</dt>
    </div>
  );
}

export function InsightsDistribution({
  parts,
  format,
}: {
  parts: readonly { id: string; label: string; value: number | undefined }[];
  format: (value: number) => string;
}): JSX.Element {
  const total = parts.reduce((sum, part) => sum + (part.value ?? 0), 0);
  let offset = 0;
  return (
    <div className="insights-distribution">
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-label={parts
          .map((part) => `${part.label}: ${part.value === undefined ? "—" : format(part.value)}`)
          .join(", ")}
      >
        <circle cx="50" cy="50" r="40" className="insights-donut-track" />
        {parts.map((part) => {
          const fraction = total > 0 ? (part.value ?? 0) / total : 0;
          const start = offset;
          offset += fraction * 100;
          return (
            <circle
              key={part.id}
              data-series={part.id}
              cx="50"
              cy="50"
              r="40"
              pathLength="100"
              strokeDasharray={`${fraction * 100} ${100 - fraction * 100}`}
              strokeDashoffset={-start}
            />
          );
        })}
        <text x="50" y="53" textAnchor="middle">
          {total ? format(total) : "—"}
        </text>
      </svg>
      <dl>
        {parts.map((part) => (
          <div key={part.id} data-series={part.id}>
            <dt>
              <i />
              {part.label}
            </dt>
            <dd>
              {part.value === undefined ? "—" : format(part.value)}{" "}
              <small>{part.value === undefined || !total ? "" : `${((part.value / total) * 100).toFixed(1)}%`}</small>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
