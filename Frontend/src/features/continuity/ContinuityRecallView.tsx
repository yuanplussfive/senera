import type { ContinuitySnapshotData } from "../../api/eventTypes";
import {
  frontendFeatureMessage as frontendMessage,
  type FrontendFeatureMessageKey as FrontendMessageKey,
} from "../../i18n/frontendFeatureMessageCatalog";
import { AppIcon } from "../../shared/ui";
import type { RunRecord } from "../../store/sessionStore";
import { formatContinuityScore, formatContinuityInteger } from "./ContinuityPanelPrimitives";

const AuditChannels: readonly {
  id: "textSimilarity" | "lexical" | "embedding";
  label: FrontendMessageKey;
}[] = [
  { id: "textSimilarity", label: "continuity.audit.textSimilarity" },
  { id: "lexical", label: "continuity.audit.lexical" },
  { id: "embedding", label: "continuity.audit.embedding" },
];

/** Retrieval evidence for the turn: query, channel mix, semantic index and local plan. */
export function ContinuityAuditCard({
  memory,
  recall,
}: {
  memory: ContinuitySnapshotData;
  recall: RunRecord["recall"];
}): JSX.Element {
  const query = memory.query ?? recall?.original;
  const counts = recall?.matchedByCounts;
  const local = recall?.local;
  const localCount = local
    ? local.terms.length +
      local.concepts.length +
      local.entities.length +
      local.relations.length +
      local.anchorLabels.length
    : 0;
  const channelTotal = counts
    ? Math.max(0, counts.textSimilarity) + Math.max(0, counts.lexical) + Math.max(0, counts.embedding)
    : 0;

  return (
    <>
      <p className="continuity-query">
        <AppIcon icon="search" size={12} aria-hidden="true" />
        {query ? (
          <q>{query}</q>
        ) : (
          <span className="continuity-query__empty">{frontendMessage("continuity.audit.noQuery")}</span>
        )}
      </p>

      {memory.diagnostics ? (
        <div className="continuity-audit__meta" data-continuity-diagnostics>
          <span>
            {frontendMessage(
              memory.diagnostics.snapshotReused ? "continuity.snapshot.reused" : "continuity.snapshot.refreshed",
              { generation: memory.snapshotGeneration ?? 0 },
            )}
          </span>
          {memory.diagnostics.unassigned > 0 ? (
            <span>
              {frontendMessage("continuity.diagnostics.unassigned", { count: memory.diagnostics.unassigned })}
            </span>
          ) : null}
          {memory.diagnostics.otherSubject > 0 ? (
            <span>
              {frontendMessage("continuity.diagnostics.otherSubject", { count: memory.diagnostics.otherSubject })}
            </span>
          ) : null}
          {memory.diagnostics.irrelevant > 0 ? (
            <span>
              {frontendMessage("continuity.diagnostics.irrelevant", { count: memory.diagnostics.irrelevant })}
            </span>
          ) : null}
          {memory.diagnostics.relevanceStatus === "unavailable" ? (
            <span>{frontendMessage("continuity.diagnostics.relevanceUnavailable")}</span>
          ) : null}
        </div>
      ) : null}

      {memory.retrieval ? <RetrievalAudit retrieval={memory.retrieval} /> : null}

      {!memory.retrieval && counts ? (
        <div className="continuity-audit__block">
          <div className="continuity-audit__cap">
            <span>{frontendMessage("continuity.audit.channels")}</span>
            <span>
              {frontendMessage("continuity.audit.hits", {
                count: formatContinuityInteger(memory.selection.events.matched),
              })}
            </span>
          </div>
          <div
            className="insights-composition continuity-stack"
            role="img"
            aria-label={frontendMessage("continuity.audit.channelsAria", {
              textSimilarity: formatContinuityInteger(counts.textSimilarity),
              lexical: formatContinuityInteger(counts.lexical),
              embedding: formatContinuityInteger(counts.embedding),
            })}
          >
            {channelTotal > 0
              ? AuditChannels.map((channel) => (
                  <span
                    key={channel.id}
                    data-series={channel.id}
                    style={{ flexGrow: Math.max(0, counts[channel.id]) }}
                  />
                ))
              : null}
          </div>
          <div className="insights-chart-legend">
            {AuditChannels.map((channel) => (
              <span key={channel.id} data-series={channel.id}>
                <i />
                {frontendMessage(channel.label)} {formatContinuityInteger(counts[channel.id])}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {!memory.retrieval && recall ? (
        <div className="continuity-audit__meta">
          {recall.latencyMs !== undefined ? (
            <span>
              {frontendMessage("continuity.audit.latency")} <b>{formatContinuityInteger(recall.latencyMs)}</b>{" "}
              {frontendMessage("continuity.unit.ms")}
            </span>
          ) : null}
          {recall.semanticStatus ? (
            <span>
              {frontendMessage("continuity.audit.semantic")}
              <i
                className="continuity-dot"
                data-state={isSemanticReady(recall.semanticStatus) ? "on" : "off"}
                aria-hidden="true"
              />
              {recall.semanticStatus}
            </span>
          ) : null}
          {recall.semanticIndexedCount !== undefined ? (
            <span>
              {frontendMessage("continuity.audit.indexed")}{" "}
              <b>{formatContinuityInteger(recall.semanticIndexedCount)}</b>
            </span>
          ) : null}
          {recall.semanticCompatibleCount !== undefined ? (
            <span>
              {frontendMessage("continuity.audit.comparable")}{" "}
              <b>{formatContinuityInteger(recall.semanticCompatibleCount)}</b>
            </span>
          ) : null}
        </div>
      ) : null}

      {recall?.degraded ? (
        <p className="continuity-audit__degraded">
          {frontendMessage("continuity.recallAudit.degraded", { reason: recall.degraded })}
        </p>
      ) : null}

      {local && (localCount > 0 || local.expanded) ? <LocalPlanDetails local={local} /> : null}
    </>
  );
}

function RetrievalAudit({ retrieval }: { retrieval: NonNullable<ContinuitySnapshotData["retrieval"]> }): JSX.Element {
  const { background, task } = retrieval;
  const sourceLabels = {
    query: "continuity.retrieval.query",
    global_preferences: "continuity.retrieval.global",
    frozen: "continuity.retrieval.frozen",
  } as const;
  return (
    <div className="continuity-audit__block" data-continuity-retrieval>
      <p className="continuity-empty-text">{frontendMessage(sourceLabels[background.source])}</p>
      {background.source !== "frozen" ? (
        <div className="continuity-audit__meta">
          <span>{frontendMessage("continuity.retrieval.candidates", { count: background.queryCandidates })}</span>
          <span>
            {frontendMessage("continuity.retrieval.preferences", { count: background.globalPreferenceCandidates })}
          </span>
          <span>{frontendMessage("continuity.retrieval.keyword", { count: background.keywordMatches })}</span>
          <span>{frontendMessage("continuity.retrieval.semantic", { count: background.semanticMatches })}</span>
        </div>
      ) : null}
      <div className="continuity-audit__meta">
        {background.searchLatencyMs !== undefined ? (
          <span>
            {frontendMessage("continuity.retrieval.searchTime", {
              value: formatContinuityScore(background.searchLatencyMs),
            })}
          </span>
        ) : null}
        {background.assessmentLatencyMs !== undefined ? (
          <span>
            {frontendMessage("continuity.retrieval.assessmentTime", {
              value: formatContinuityScore(background.assessmentLatencyMs),
            })}
          </span>
        ) : null}
        <span>
          {frontendMessage("continuity.retrieval.task", {
            count: task.candidates,
            value: formatContinuityScore(task.latencyMs),
          })}
        </span>
        {background.status === "unavailable" || task.status === "unavailable" ? (
          <span>{frontendMessage("continuity.retrieval.unavailable")}</span>
        ) : null}
        {retrieval.related ? (
          <span>{frontendMessage("continuity.retrieval.related", { count: retrieval.related.candidates })}</span>
        ) : null}
        {retrieval.related?.status === "unavailable" ? (
          <span>{frontendMessage("continuity.diagnostics.relevanceUnavailable")}</span>
        ) : null}
      </div>
    </div>
  );
}

function isSemanticReady(status: string): boolean {
  return /^(indexed|ready|active|enabled)$/i.test(status);
}

function LocalPlanDetails({ local }: { local: NonNullable<NonNullable<RunRecord["recall"]>["local"]> }): JSX.Element {
  return (
    <details className="continuity-audit__local" data-continuity-local-plan>
      <summary>
        <AppIcon icon="chevron-right" size={10} aria-hidden="true" />
        <span>
          {frontendMessage("continuity.audit.localSummary", {
            terms: formatContinuityInteger(local.terms.length),
            concepts: formatContinuityInteger(local.concepts.length),
            entities: formatContinuityInteger(local.entities.length),
            relations: formatContinuityInteger(local.relations.length),
            anchors: formatContinuityInteger(local.anchorLabels.length),
          })}
        </span>
        <span className="continuity-audit__more">{frontendMessage("continuity.audit.view")}</span>
      </summary>
      <div className="continuity-chips">
        <ChipGroup label="continuity.audit.terms" items={local.terms} />
        <ChipGroup label="continuity.audit.concepts" items={local.concepts.map((item) => item.label)} />
        <ChipGroup label="continuity.audit.entities" items={local.entities.map((item) => item.label)} />
        <ChipGroup label="continuity.audit.relations" items={local.relations.map((item) => item.label)} />
        <ChipGroup label="continuity.audit.anchors" items={local.anchorLabels} />
      </div>
      {local.expanded ? (
        <p className="continuity-audit__expanded">{frontendMessage("continuity.audit.localExpanded")}</p>
      ) : null}
    </details>
  );
}

function ChipGroup({ label, items }: { label: FrontendMessageKey; items: readonly string[] }): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <span className="continuity-chips__group">
      <em>{frontendMessage(label)}</em>
      {items.map((item, index) => (
        <span key={`${item}-${index}`} className="continuity-chip">
          {item}
        </span>
      ))}
    </span>
  );
}
