import { useCallback, useMemo, useState } from "react";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { formatDateTime } from "../../lib/util";
import { AppIcon } from "../../shared/ui";
import { hasResponsiveMediaSupport } from "../../shared/responsive";
import type { ContinuitySnapshotData } from "../../api/eventTypes";
import type { RunRecord } from "../../store/sessionStore";
import { ContinuityEmptyText, formatContinuityConfidence } from "./ContinuityPanelPrimitives";

type RecallRecord =
  | ({ kind: "digest" } & ContinuitySnapshotData["periodDigests"][number])
  | ({ kind: "event" } & ContinuitySnapshotData["eventCandidates"][number]);

/**
 * A flat, inspectable MemOS ledger. The default row stays quiet; the retrieval
 * evidence is available inline so the panel never turns into a stack of cards.
 */
export function ContinuityRecallView({ run, showTitle = true }: { run: RunRecord; showTitle?: boolean }): JSX.Element {
  const memory = run.continuity;
  if (!memory) throw new Error("Continuity recall view requires a turn snapshot.");
  const [expandedUri, setExpandedUri] = useState<string | undefined>();
  const [ledgerRef] = useAutoAnimate<HTMLDivElement>({ duration: 180, easing: "ease-out" });
  const setLedgerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!hasResponsiveMediaSupport()) return;
      ledgerRef(node);
    },
    [ledgerRef],
  );
  const records = useMemo<RecallRecord[]>(
    () => [
      ...memory.periodDigests.map((entry) => ({ ...entry, kind: "digest" as const })),
      ...memory.eventCandidates.map((entry) => ({ ...entry, kind: "event" as const })),
    ],
    [memory.eventCandidates, memory.periodDigests],
  );
  const query = memory.query ?? run.recall?.original;

  return (
    <section className="space-y-0 px-4 py-4" data-continuity-knowledge>
      {showTitle ? (
        <header className="mb-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-medium text-content-primary">
              {frontendMessage("continuity.tab.knowledge")}
            </h3>
            <p className="mt-1 text-[11px] text-content-muted">
              {records.length} {frontendMessage("continuity.recallAudit.records")} · {memory.selection.usedTokens} /{" "}
              {memory.selection.maxTokens} tokens
            </p>
          </div>
          <AppIcon icon="book-open" size={16} className="shrink-0 text-content-muted" aria-hidden="true" />
        </header>
      ) : null}

      <RecallAudit memory={memory} query={query} recall={run.recall} />

      {records.length === 0 ? (
        <ContinuityEmptyText>{frontendMessage("continuity.emptyEventCandidates")}</ContinuityEmptyText>
      ) : (
        <div ref={setLedgerRef} className="border-t border-line-subtle" data-continuity-ledger>
          <div className="hidden grid-cols-[7.5rem_minmax(0,1fr)_5.25rem_1rem] gap-3 border-b border-line-subtle px-1 py-2 text-[10px] font-medium text-content-muted sm:grid">
            <span>{frontendMessage("continuity.recallAudit.typeColumn")}</span>
            <span>{frontendMessage("continuity.tab.knowledge")}</span>
            <span className="text-right">{frontendMessage("continuity.recallScore", { score: "" })}</span>
            <span aria-hidden="true" />
          </div>
          {records.map((record) => {
            const expanded = expandedUri === record.uri;
            return (
              <div key={record.uri} className="border-b border-line-subtle" data-continuity-record={record.uri}>
                <button
                  type="button"
                  className={cn(
                    "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 px-1 py-3 text-left transition-colors",
                    "hover:bg-surface-subtle/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-focus",
                    expanded && "bg-surface-subtle/45",
                  )}
                  aria-expanded={expanded}
                  onClick={() => setExpandedUri(expanded ? undefined : record.uri)}
                >
                  <span className="grid min-w-0 grid-cols-[6.75rem_minmax(0,1fr)] gap-3 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-[11px] font-medium text-content-primary">
                        <span
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            record.kind === "digest" ? "bg-accent-solid" : "bg-umber-500",
                          )}
                        />
                        <span className="truncate">{recordLabel(record)}</span>
                      </span>
                    </span>
                    <span className="min-w-0">
                      <span className="block break-words text-[12px] leading-5 text-content-primary">
                        <span className="mr-1 text-[10px] tabular-nums text-content-muted">
                          [{formatDateTime(record.kind === "digest" ? record.periodStart : record.occurredAt)}]
                        </span>
                        <span>{record.summary}</span>
                      </span>
                      <span className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-content-muted">
                        {record.matchedBy.map((method) => (
                          <span key={method}>{matchMethodLabel(method)}</span>
                        ))}
                      </span>
                    </span>
                  </span>
                  <span className="flex items-start gap-2 pt-0.5">
                    <span className="w-12 text-right text-[11px] tabular-nums text-content-secondary">
                      {formatContinuityConfidence(record.score)}
                    </span>
                    <AppIcon
                      icon="chevron-down"
                      size={14}
                      className={cn("mt-0.5 text-content-muted transition-transform", expanded && "rotate-180")}
                      aria-hidden="true"
                    />
                  </span>
                </button>
                {expanded ? <RecallRecordDetails record={record} /> : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function RecallAudit({
  memory,
  query,
  recall,
}: {
  memory: ContinuitySnapshotData;
  query?: string;
  recall: RunRecord["recall"];
}): JSX.Element {
  const selected = memory.selection.digests.selected + memory.selection.events.selected;
  const matched = memory.selection.digests.matched + memory.selection.events.matched;
  const counts = recall?.matchedByCounts;
  const local = recall?.local;
  const semanticStatus = recall?.semanticStatus;
  return (
    <div className="mb-4 border-b border-line-subtle pb-3" data-continuity-recall-audit>
      <div className="flex items-start gap-2">
        <AppIcon icon="search" size={14} className="mt-0.5 shrink-0 text-accent-content" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-content-primary">
            {frontendMessage("continuity.recallAudit")}
            <span className="ml-2 font-normal tabular-nums text-content-muted">
              {selected} / {matched}
            </span>
          </p>
          {query ? (
            <p className="mt-1 break-words text-[11px] leading-5 text-content-secondary">
              {frontendMessage("continuity.recallAudit.query", { query })}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-l border-line-subtle pl-3 text-[10px] leading-4 text-content-muted sm:grid-cols-3">
        <span>
          {frontendMessage("continuity.recallAudit.injected")}: {selected}
        </span>
        {recall?.latencyMs !== undefined ? (
          <span className="tabular-nums">
            {frontendMessage("continuity.recallAudit.latency", { ms: recall.latencyMs })}
          </span>
        ) : null}
        {counts ? (
          <span className="col-span-2 sm:col-span-3">
            {frontendMessage("continuity.recallAudit.matched", {
              textSimilarity: counts.textSimilarity,
              lexical: counts.lexical,
              embedding: counts.embedding,
            })}
          </span>
        ) : null}
        {semanticStatus ? (
          <span className="col-span-2 break-words sm:col-span-3">
            {frontendMessage("continuity.recallAudit.semantic", {
              status: semanticStatus,
              indexed: recall?.semanticIndexedCount ?? 0,
              compatible: recall?.semanticCompatibleCount ?? 0,
            })}
          </span>
        ) : null}
        {local ? <LocalPlanSummary local={local} /> : null}
      </div>
    </div>
  );
}

function LocalPlanSummary({ local }: { local: NonNullable<NonNullable<RunRecord["recall"]>["local"]> }): JSX.Element {
  return (
    <details className="col-span-2 text-content-muted sm:col-span-3">
      <summary className="cursor-pointer list-none text-content-secondary marker:hidden">
        {frontendMessage("continuity.recallAudit.local", {
          terms: local.terms.length,
          concepts: local.concepts.length,
          entities: local.entities.length,
          relations: local.relations.length,
          anchors: local.anchorLabels.length,
        })}
      </summary>
      <div className="mt-2 space-y-1.5 border-l border-line-subtle pl-3">
        {local.terms.length > 0 ? <p>terms: {local.terms.join(" · ")}</p> : null}
        {local.concepts.length > 0 ? <p>concepts: {local.concepts.map((item) => item.label).join(" · ")}</p> : null}
        {local.entities.length > 0 ? <p>entities: {local.entities.map((item) => item.label).join(" · ")}</p> : null}
        {local.relations.length > 0 ? <p>relations: {local.relations.map((item) => item.label).join(" · ")}</p> : null}
        {local.anchorLabels.length > 0 ? (
          <p>{frontendMessage("continuity.recallAudit.anchors", { anchors: local.anchorLabels.join(" · ") })}</p>
        ) : null}
        {local.expanded ? <p>{frontendMessage("continuity.recallAudit.localExpanded")}</p> : null}
      </div>
    </details>
  );
}

function RecallRecordDetails({ record }: { record: RecallRecord }): JSX.Element {
  const scores = record.scores;
  return (
    <div className="grid gap-3 border-t border-line-subtle bg-surface-subtle/35 px-1 py-3 pl-[7.75rem] text-[10px] leading-4 text-content-muted sm:grid-cols-2 sm:pl-[8.75rem]">
      <div className="min-w-0">
        <p className="mb-1 font-medium text-content-secondary">{frontendMessage("continuity.recallAudit.channel")}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {record.matchedBy.map((method) => (
            <span key={method} className="text-[10px] text-content-secondary">
              {matchMethodLabel(method)}
            </span>
          ))}
        </div>
      </div>
      <div className="min-w-0">
        <p className="mb-1 font-medium text-content-secondary">{frontendMessage("continuity.recallAudit.breakdown")}</p>
        {scores ? (
          <div className="flex flex-wrap gap-x-3 gap-y-1 tabular-nums">
            {scores.keyword !== undefined ? (
              <span>
                {frontendMessage("continuity.recallAudit.keyword")} {formatContinuityConfidence(scores.keyword)}
              </span>
            ) : null}
            {scores.semantic !== undefined ? (
              <span>
                {frontendMessage("continuity.recallAudit.semanticChannel")}{" "}
                {formatContinuityConfidence(scores.semantic)}
              </span>
            ) : null}
            {scores.hybrid !== undefined ? (
              <span>
                {frontendMessage("continuity.recallAudit.hybrid")} {formatContinuityConfidence(scores.hybrid)}
              </span>
            ) : null}
          </div>
        ) : (
          <span>{frontendMessage("continuity.recallAudit.noBreakdown")}</span>
        )}
      </div>
      <p className="min-w-0 break-all sm:col-span-2">
        {frontendMessage("continuity.recallAudit.source", { uri: record.uri })}
      </p>
      <p className="min-w-0 break-all sm:col-span-2">
        {frontendMessage("continuity.recallAudit.revision", { revision: record.revision })}
      </p>
    </div>
  );
}

function recordLabel(record: RecallRecord): string {
  if (record.kind === "digest") {
    return frontendMessage(
      record.granularity === "month" ? "continuity.kind.digest.month" : "continuity.kind.digest.day",
    );
  }
  return memoryTypeLabel(record.type);
}

function memoryTypeLabel(type: string): string {
  const key = `continuity.kind.${type}` as FrontendMessageKey;
  const supported = new Set([
    "continuity.kind.fact",
    "continuity.kind.preference",
    "continuity.kind.relationship",
    "continuity.kind.context",
    "continuity.kind.entity",
    "continuity.kind.custom",
  ]);
  return supported.has(key) ? frontendMessage(key) : type;
}

function matchMethodLabel(method: string): string {
  const keyByMethod: Record<string, FrontendMessageKey> = {
    memos: "continuity.recallAudit.memos",
    keyword: "continuity.recallAudit.keyword",
    semantic: "continuity.recallAudit.semanticChannel",
    embedding: "continuity.recallAudit.semanticChannel",
    hybrid: "continuity.recallAudit.hybrid",
    "exact-reference": "continuity.recallAudit.exactReference",
  };
  return frontendMessage(keyByMethod[method] ?? "continuity.recallAudit.unknown");
}
