import type { ReactNode } from "react";
import type { ContinuitySnapshotData } from "../../api/eventTypes";
import { resolveRuntimeTimeZone } from "../../config/runtimeConfig";
import {
  frontendFeatureMessage as frontendMessage,
  type FrontendFeatureMessageKey as FrontendMessageKey,
} from "../../i18n/frontendFeatureMessageCatalog";
import { formatInteger } from "../../lib/util";
import { InsightsSectionTitle } from "../observability/insightsPrimitives";

export type ContinuityRecord = ContinuitySnapshotData["eventCandidates"][number];
export type ContinuityRecordType = ContinuityRecord["type"];

const CompactDateFormatters = new Map<string, Intl.DateTimeFormat>();

const ContinuityTypeLabels: Record<ContinuityRecordType, FrontendMessageKey> = {
  fact: "continuity.kind.fact",
  preference: "continuity.kind.preference",
  relationship: "continuity.kind.relationship",
  context: "continuity.kind.context",
};

const MatchMethodLabels: Record<string, FrontendMessageKey | undefined> = {
  memos: "continuity.recallAudit.memos",
  keyword: "continuity.recallAudit.keyword",
  semantic: "continuity.recallAudit.semanticChannel",
  embedding: "continuity.recallAudit.semanticChannel",
  hybrid: "continuity.recallAudit.hybrid",
  "exact-reference": "continuity.recallAudit.exactReference",
  relevance_assessment: "continuity.recallAudit.relevance",
  task: "continuity.kind.context",
  current_task: "continuity.kind.context",
  global_preference: "continuity.recallAudit.globalPreference",
  related_knowledge: "continuity.recallAudit.relatedKnowledge",
  historical_task: "continuity.recallAudit.historicalTask",
};

/** Counts and budget belong to this injection snapshot, not a frontend quality model. */
export function readContinuitySummary(memory: ContinuitySnapshotData) {
  const selected =
    memory.selection.events.selected +
    (memory.selection.tasks?.selected ?? 0) +
    (memory.selection.related?.selected ?? 0);
  const matched =
    memory.selection.events.matched + (memory.selection.tasks?.matched ?? 0) + (memory.selection.related?.matched ?? 0);
  const usedTokens = memory.selection.usedTokens;
  const maxTokens = memory.selection.maxTokens;
  return {
    selected,
    matched,
    usedTokens,
    maxTokens,
    usedRatio: maxTokens > 0 ? clampContinuityRatio(usedTokens / maxTokens) : 0,
  };
}

export function ContinuityCard({
  title,
  note,
  count,
  group,
  children,
}: {
  title: FrontendMessageKey;
  note?: ReactNode;
  count?: number;
  group?: "frozen" | "task" | "related";
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="insights-section continuity-group" data-continuity-group={group}>
      <InsightsSectionTitle
        title={frontendMessage(title)}
        note={note}
        count={count}
        countLabel={count === undefined ? undefined : frontendMessage("continuity.budget.records", { count })}
      />
      {children}
    </section>
  );
}

export function clampContinuityRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Only format producer values; do not normalize one score into a different metric. */
export function formatContinuityScore(value: number | undefined): string {
  return value === undefined ? "—" : String(Math.round(value * 1000) / 1000);
}

export function formatContinuityPercent(value: number | undefined): string {
  return value === undefined ? "—" : `${formatContinuityScore(value * 100)}%`;
}

export function formatContinuityDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const timeZone = resolveRuntimeTimeZone();
  const key = `${locale}:${timeZone}`;
  let formatter = CompactDateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { timeZone, month: "short", day: "numeric" });
    CompactDateFormatters.set(key, formatter);
  }
  return formatter.format(date);
}

export function formatContinuityInteger(value: number): string {
  return formatInteger(Math.round(Number.isFinite(value) ? value : 0));
}

export function memoryTypeLabel(type: ContinuityRecordType): string {
  return frontendMessage(ContinuityTypeLabels[type]);
}

export function matchMethodLabel(method: string): string | undefined {
  const key = MatchMethodLabels[method];
  return key ? frontendMessage(key) : undefined;
}
