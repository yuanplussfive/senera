import { useMemo } from "react";
import { frontendFeatureMessage as t } from "../../i18n/frontendFeatureMessageCatalog";
import { formatDurationMs } from "../../lib/util";
import { executionTimings, type ExecutionInspectionRow } from "./executionInspectionModel";
import { executionRecordTitle } from "./ExecutionInspectionRow";

/** A shared time axis makes waiting and overlapping calls visible without reading every record. */
export function ExecutionTimingOverview({
  rows,
  selectedId,
  onSelect,
}: {
  rows: readonly ExecutionInspectionRow[];
  selectedId?: string;
  onSelect: (id: string) => void;
}): JSX.Element | null {
  const timing = useMemo(() => executionTimings(rows), [rows]);
  const labels = useMemo(
    () => new Map(rows.flatMap((row) => (row.kind === "step" ? [[row.id, executionRecordTitle(row)] as const] : []))),
    [rows],
  );
  if (timing.length === 0) return null;
  const start = Math.min(...timing.map((entry) => entry.start));
  const end = Math.max(...timing.map((entry) => entry.end ?? entry.start));
  const span = Math.max(end - start, 1);
  return (
    <div className="insights-timing-overview" aria-label={t("insights.process.timeOverview")}>
      <div className="insights-timing-axis">
        <span>{t("insights.process.timeOverview")}</span>
        <span>0</span>
        <span>{end > start ? formatDurationMs(end - start) : "—"}</span>
      </div>
      {(["model", "tool"] as const).map((kind) => (
        <div className="insights-timing-lane" key={kind}>
          <span>{t(kind === "model" ? "insights.process.filter.model" : "insights.process.filter.tool")}</span>
          <div>
            {timing
              .filter((entry) => entry.kind === kind)
              .map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  data-status={entry.step.status}
                  data-selected={entry.id === selectedId || undefined}
                  style={{
                    left: `${((entry.start - start) / span) * 100}%`,
                    width: entry.end === undefined ? undefined : `${((entry.end - entry.start) / span) * 100}%`,
                  }}
                  title={`${labels.get(entry.id)} · ${entry.end === undefined ? t("insights.process.timingStartOnly") : formatDurationMs(entry.end - entry.start)}`}
                  aria-label={t("insights.process.locateRecord", { name: labels.get(entry.id) ?? entry.id })}
                  onClick={() => onSelect(entry.id)}
                />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
