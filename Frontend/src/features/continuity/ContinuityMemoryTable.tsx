import type { ContinuitySnapshotData } from "../../api/eventTypes";
import { frontendFeatureMessage as t, type FrontendFeatureMessageKey } from "../../i18n/frontendFeatureMessageCatalog";
import { useFrontendLocale } from "../../i18n/useFrontendLocale";
import { AppIcon, Button } from "../../shared/ui";
import {
  ContinuityCard,
  formatContinuityDate,
  formatContinuityInteger,
  formatContinuityPercent,
  formatContinuityScore,
  matchMethodLabel,
  memoryTypeLabel,
  type ContinuityRecord,
} from "./ContinuityPanelPrimitives";

export interface ContinuityMemorySort {
  column: "weight" | "recallCount";
  direction: "asc" | "desc";
}

const SortColumns = [
  { key: "weight", label: "continuity.table.weight" },
  { key: "recallCount", label: "continuity.table.recalls" },
] as const;

function recordQuality(memory: ContinuitySnapshotData, record: ContinuityRecord) {
  return memory.currentQuality?.[record.id] ?? record.quality;
}

function compareRecords(
  memory: ContinuitySnapshotData,
  left: ContinuityRecord,
  right: ContinuityRecord,
  sort: ContinuityMemorySort,
): number {
  const a = recordQuality(memory, left)?.[sort.column];
  const b = recordQuality(memory, right)?.[sort.column];
  if (a === undefined) return b === undefined ? 0 : 1;
  if (b === undefined) return -1;
  return (a - b) * (sort.direction === "asc" ? 1 : -1);
}

export function ContinuityMemoryTable({
  memory,
  entries,
  title,
  group,
  expandedId,
  scoresId,
  sort,
  onSort,
  onExpand,
  onExpandScores,
}: {
  memory: ContinuitySnapshotData;
  entries: readonly ContinuityRecord[];
  title: FrontendFeatureMessageKey;
  group: "frozen" | "task" | "related";
  expandedId?: string;
  scoresId?: string;
  sort?: ContinuityMemorySort;
  onSort: (sort: ContinuityMemorySort | undefined) => void;
  onExpand: (id: string | undefined) => void;
  onExpandScores: (id: string | undefined) => void;
}): JSX.Element {
  const records = sort ? [...entries].sort((a, b) => compareRecords(memory, a, b, sort)) : entries;
  return (
    <ContinuityCard title={title} count={records.length} group={group}>
      <table className="continuity-memory-table" aria-label={t(title)} data-continuity-ledger>
        <thead>
          <tr>
            <th scope="col">{t("continuity.table.content")}</th>
            <th scope="col" className="continuity-memory-table__type">
              {t("continuity.table.type")}
            </th>
            {SortColumns.map(({ key, label }) => (
              <th
                key={key}
                scope="col"
                className={`continuity-memory-table__${key}`}
                aria-sort={sort?.column === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="continuity-table-sort"
                  onClick={() =>
                    onSort(
                      sort?.column !== key
                        ? { column: key, direction: "desc" }
                        : sort.direction === "desc"
                          ? { column: key, direction: "asc" }
                          : undefined,
                    )
                  }
                >
                  {t(label)}
                  <AppIcon
                    icon={sort?.column === key && sort.direction === "asc" ? "chevron-up" : "chevron-down"}
                    size={9}
                  />
                </Button>
              </th>
            ))}
          </tr>
        </thead>
        {records.map((record) => {
          const key = `${record.id}@${record.revision}`;
          const expanded = expandedId === key;
          const quality = recordQuality(memory, record);
          return (
            <tbody key={key} data-continuity-record={record.uri} data-type={record.type} data-expanded={expanded}>
              <tr className="continuity-memory-table__entry">
                <td>
                  <button
                    type="button"
                    className="continuity-candidate__row"
                    aria-expanded={expanded}
                    onClick={() => onExpand(expanded ? undefined : key)}
                  >
                    <span className="continuity-candidate__summary">{record.summary}</span>
                    <AppIcon icon="chevron-right" size={10} className={expanded ? "rotate-90" : undefined} />
                  </button>
                </td>
                <td className="continuity-memory-table__type" data-series={record.type}>
                  {memoryTypeLabel(record.type)}
                </td>
                <td className="continuity-memory-table__weight" title={t("continuity.recallAudit.weightedScore")}>
                  <span>{quality ? formatContinuityPercent(quality.weight / 100) : "—"}</span>
                  {quality ? (
                    <span className="continuity-weight-meter" aria-hidden="true">
                      <i style={{ width: `${quality.weight}%` }} />
                    </span>
                  ) : null}
                </td>
                <td className="continuity-memory-table__recallCount">
                  {quality ? formatContinuityInteger(quality.recallCount) : "—"}
                </td>
              </tr>
              {expanded ? (
                <tr className="continuity-memory-table__details">
                  <td colSpan={4}>
                    <MemoryRecordDetails
                      record={record}
                      currentQuality={memory.currentQuality?.[record.id]}
                      scoresOpen={scoresId === key}
                      onExpandScores={(open) => onExpandScores(open ? key : undefined)}
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          );
        })}
      </table>
    </ContinuityCard>
  );
}

const QualityFields = [
  { key: "weight", label: "continuity.recallAudit.weightedScore", percent: true },
  { key: "recallCount", label: "continuity.quality.recalls", percent: false },
  { key: "helpfulCount", label: "continuity.quality.helpful", percent: false },
  { key: "unhelpfulCount", label: "continuity.quality.unhelpful", percent: false },
  { key: "unusedCount", label: "continuity.quality.unused", percent: false },
  { key: "uncertainCount", label: "continuity.quality.uncertain", percent: false },
  { key: "pendingCount", label: "continuity.quality.pending", percent: false },
] as const;

function qualityValue(value: number, percent: boolean): string {
  return percent ? formatContinuityPercent(value / 100) : formatContinuityInteger(value);
}

function MemoryRecordDetails({
  record,
  currentQuality,
  scoresOpen,
  onExpandScores,
}: {
  record: ContinuityRecord;
  currentQuality?: ContinuityRecord["quality"];
  scoresOpen: boolean;
  onExpandScores: (open: boolean) => void;
}): JSX.Element {
  const locale = useFrontendLocale();
  const quality = currentQuality ?? record.quality;
  const selectedQuality = record.quality;
  const comparison =
    currentQuality && selectedQuality
      ? QualityFields.filter(({ key }) => currentQuality[key] !== selectedQuality[key]).map((field) => ({
          ...field,
          selected: selectedQuality[field.key],
          current: currentQuality[field.key],
        }))
      : [];
  const sources = [
    ...new Set(
      record.matchedBy
        .filter((method) => method !== "memos")
        .map(matchMethodLabel)
        .filter((label) => label !== undefined && label !== memoryTypeLabel(record.type)),
    ),
  ];
  const scores = [
    { value: record.score, label: "continuity.recordRanking", format: "raw" },
    { value: record.scores?.keyword, label: "continuity.recallAudit.keyword", format: "raw" },
    { value: record.scores?.semantic, label: "continuity.recallAudit.semanticChannel", format: "raw" },
    { value: record.scores?.hybrid, label: "continuity.recallAudit.hybrid", format: "raw" },
    { value: record.scores?.relevance, label: "continuity.recallAudit.relevance", format: "ratio" },
    { value: record.scores?.recency, label: "continuity.recallAudit.recency", format: "ratio" },
  ] as const;
  return (
    <div className="continuity-candidate__detail">
      <dl className="continuity-record-properties">
        <div>
          <dt>{t("continuity.table.recorded")}</dt>
          <dd>
            <time dateTime={record.occurredAt} title={record.occurredAt}>
              {formatContinuityDate(record.occurredAt, locale)}
            </time>
          </dd>
        </div>
        {record.retention ? (
          <div>
            <dt>{t("continuity.table.retention")}</dt>
            <dd>
              {t(record.retention.days === 0 ? "continuity.retention.permanent" : "continuity.retention.days", {
                days: record.retention.days,
              })}
            </dd>
          </div>
        ) : null}
        {sources.length > 0 ? (
          <div className="continuity-record-properties__source">
            <dt>{t("continuity.table.source")}</dt>
            <dd>{sources.join(" / ")}</dd>
          </div>
        ) : null}
        {quality
          ? QualityFields.filter(
              ({ key }) => key !== "weight" && key !== "recallCount" && (key === "helpfulCount" || quality[key] > 0),
            ).map(({ key, label }) => (
              <div key={key}>
                <dt>{t(label)}</dt>
                <dd>{formatContinuityInteger(quality[key])}</dd>
              </div>
            ))
          : null}
      </dl>
      <details
        className="continuity-record-analysis"
        open={scoresOpen}
        onToggle={(event) => {
          if (scoresOpen !== event.currentTarget.open) onExpandScores(event.currentTarget.open);
        }}
      >
        <summary>
          <AppIcon icon="chevron-right" size={10} />
          {t("continuity.recordDetails")}
        </summary>
        <table className="continuity-score-table" aria-label={t("continuity.recordDetails")}>
          <tbody>
            {scores.map(({ value, label, format }) =>
              value === undefined ? null : (
                <tr key={label}>
                  <th scope="row">{t(label)}</th>
                  <td className={label === "continuity.recordRanking" ? "continuity-candidate__score" : undefined}>
                    {format === "raw" ? formatContinuityScore(value) : formatContinuityPercent(value)}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
        {comparison.length > 0 ? (
          <table className="continuity-quality-comparison">
            <thead>
              <tr>
                <th />
                <th scope="col">{t("continuity.quality.selected")}</th>
                <th scope="col">{t("continuity.quality.current")}</th>
              </tr>
            </thead>
            <tbody>
              {comparison.map(({ key, label, percent, selected, current }) => (
                <tr key={key}>
                  <th scope="row">{t(label)}</th>
                  <td>{qualityValue(selected, percent)}</td>
                  <td>{qualityValue(current, percent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </details>
    </div>
  );
}
