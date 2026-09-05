import { ChevronDown, Clock3, FileText, Filter, Link2, Network, Scale, Search } from "lucide-react";
import type {
  ContinuityRecallLocalMatchData,
  ContinuityRecallLocalPlanData,
  ContinuityRecallLocalRelationData,
  ContinuitySelectionCountData,
} from "../../api/eventTypes";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import { formatDateTime } from "../../lib/util";
import type { RunRecord } from "../../store/sessionStore";
import { ContinuityEmptyText, ContinuitySubsection, formatContinuityConfidence } from "./ContinuityPanelPrimitives";

export function ContinuityRecallInspector({ run }: { run: RunRecord }): JSX.Element {
  const continuity = run.continuity;
  if (!continuity) throw new Error("Continuity recall inspector requires a turn snapshot.");

  return (
    <details className="group border-y border-line-subtle py-0" data-continuity-inspector>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[11px] font-medium text-content-secondary [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">{frontendMessage("continuity.knowledge.inspect")}</span>
        <ChevronDown
          className="h-3.5 w-3.5 shrink-0 text-content-muted transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="space-y-4 border-t border-line-subtle py-3">
        <SelectionSummary selection={continuity.selection} />
        <RecallAudit run={run} />
        <PromptHarnessAudit run={run} />
        <RecallDiagnostics continuity={continuity} />
        <FactEvidence continuity={continuity} />
        <ConceptCatalog continuity={continuity} />
        <EventRecall continuity={continuity} />
        <EvidenceRecall continuity={continuity} />
      </div>
    </details>
  );
}

function PromptHarnessAudit({ run }: { run: RunRecord }): JSX.Element | null {
  const harness = run.harness;
  if (!harness) return null;
  const rows = [
    ["continuity.harness.frozen", harness.sections.frozen.tokens, harness.sections.frozen.bytes],
    ["continuity.harness.stable", harness.sections.stable.tokens, harness.sections.stable.bytes],
    ["continuity.harness.volatile", harness.sections.volatile.tokens, harness.sections.volatile.bytes],
  ] as const;
  return (
    <ContinuitySubsection icon={Scale} title="continuity.harness">
      <ul className="space-y-1">
        {rows.map(([label, tokens, bytes]) => (
          <li key={label} className="flex items-baseline justify-between gap-2 text-[10.5px] leading-5">
            <span className="text-content-secondary">{frontendMessage(label)}</span>
            <span className="shrink-0 tabular-nums text-content-muted">
              {frontendMessage("continuity.harness.size", { tokens, bytes })}
            </span>
          </li>
        ))}
      </ul>
    </ContinuitySubsection>
  );
}

function RecallAudit({ run }: { run: RunRecord }): JSX.Element | null {
  const recall = run.recall;
  if (!recall) return null;
  const matched = recall.matchedByCounts;
  const matchSummary = matched
    ? frontendMessage("continuity.recallAudit.matched", {
        textSimilarity: matched.textSimilarity,
        lexical: matched.lexical,
        embedding: matched.embedding,
      })
    : undefined;
  const degradationLabel =
    recall.degraded && recall.degraded !== "none"
      ? frontendMessage("continuity.recallAudit.degraded", { reason: recall.degraded })
      : null;
  const localPlan = recall.local;
  const localPlanSummary = localPlan
    ? frontendMessage("continuity.recallAudit.local", {
        terms: localPlan.terms.length,
        concepts: localPlan.concepts.length,
        entities: localPlan.entities.length,
        relations: localPlan.relations.length,
        anchors: localPlan.anchorLabels.length,
      })
    : null;
  return (
    <ContinuitySubsection icon={Search} title="continuity.recallAudit">
      <ul className="space-y-1.5">
        <li className="flex items-baseline gap-2 text-[10.5px] leading-5 text-content-secondary">
          <span className="shrink-0 text-content-disabled">{frontendMessage("continuity.recallAudit.injected")}</span>
          <span className="truncate tabular-nums">{recall.injectedCount ?? 0}</span>
        </li>
        {matchSummary ? (
          <li className="truncate text-[10px] leading-5 text-content-disabled" title={matchSummary}>
            {matchSummary}
          </li>
        ) : null}
        {recall.semanticStatus ? (
          <li className="truncate text-[10px] leading-5 text-content-disabled" title={recall.semanticStatus}>
            {frontendMessage("continuity.recallAudit.semantic", {
              status: recall.semanticStatus,
              indexed: recall.semanticIndexedCount ?? 0,
              compatible: recall.semanticCompatibleCount ?? 0,
            })}
          </li>
        ) : null}
        {localPlanSummary ? <li className="text-[10px] leading-5 text-content-secondary">{localPlanSummary}</li> : null}
        {localPlan ? <LocalPlanDetails plan={localPlan} /> : null}
        {localPlan?.expanded ? (
          <li className="text-[10px] leading-5 text-content-muted">
            {frontendMessage("continuity.recallAudit.localExpanded")}
          </li>
        ) : null}
        {localPlan?.anchorLabels.length ? (
          <li className="break-words text-[10px] leading-5 text-content-secondary">
            {frontendMessage("continuity.recallAudit.anchors", { anchors: localPlan.anchorLabels.join(" / ") })}
          </li>
        ) : null}
        {degradationLabel ? (
          <li className="break-words text-[10px] leading-5 text-content-secondary">{degradationLabel}</li>
        ) : null}
        {recall.latencyMs !== undefined ? (
          <li className="text-[10px] leading-5 text-content-disabled">
            {frontendMessage("continuity.recallAudit.latency", { ms: recall.latencyMs })}
          </li>
        ) : null}
      </ul>
    </ContinuitySubsection>
  );
}

function LocalPlanDetails({ plan }: { plan: ContinuityRecallLocalPlanData }): JSX.Element | null {
  if (plan.concepts.length === 0 && plan.entities.length === 0 && plan.relations.length === 0) return null;
  return (
    <li>
      <details className="group border-y border-line-subtle py-1.5">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10px] leading-5 text-content-secondary [&::-webkit-details-marker]:hidden">
          <ChevronDown
            className="h-3 w-3 shrink-0 text-content-muted transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
          <span>{frontendMessage("continuity.recallAudit.localDetails")}</span>
        </summary>
        <div className="mt-2 space-y-2">
          <LocalMatchGroup label="continuity.recallAudit.concepts" matches={plan.concepts} />
          <LocalMatchGroup label="continuity.recallAudit.entities" matches={plan.entities} />
          <LocalRelationGroup label="continuity.recallAudit.relations" matches={plan.relations} />
        </div>
      </details>
    </li>
  );
}

function LocalMatchGroup({
  label,
  matches,
}: {
  label: FrontendMessageKey;
  matches: readonly ContinuityRecallLocalMatchData[];
}): JSX.Element | null {
  if (matches.length === 0) return null;
  return (
    <section>
      <p className="mb-1 text-[9.5px] font-medium leading-4 text-content-muted">{frontendMessage(label)}</p>
      <ul className="space-y-1">
        {matches.map((match, index) => (
          <li key={`${match.label}:${index}`} className="min-w-0 border-l border-line-subtle pl-2">
            <div className="flex min-w-0 items-baseline gap-2 text-[10px] leading-4">
              <span
                className="min-w-0 flex-1 truncate text-content-secondary"
                title={match.matchedLabel ?? match.label}
              >
                {match.matchedLabel ?? match.label}
              </span>
              <span className="shrink-0 tabular-nums text-content-muted">
                {formatContinuityConfidence(match.score)}
              </span>
            </div>
            <p className="break-words text-[9px] leading-4 text-content-disabled">
              {match.matchedBy.join(" / ")}
              {match.matchedTerms?.length ? ` · ${match.matchedTerms.join(" / ")}` : ""}
              {match.anchorEligible ? ` · ${frontendMessage("continuity.recallAudit.anchorEligible")}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LocalRelationGroup({
  label,
  matches,
}: {
  label: FrontendMessageKey;
  matches: readonly ContinuityRecallLocalRelationData[];
}): JSX.Element | null {
  if (matches.length === 0) return null;
  return (
    <section>
      <p className="mb-1 text-[9.5px] font-medium leading-4 text-content-muted">{frontendMessage(label)}</p>
      <ul className="space-y-1">
        {matches.map((match) => (
          <li
            key={match.relationId}
            className="flex min-w-0 items-baseline gap-2 border-l border-line-subtle pl-2 text-[10px] leading-4"
          >
            <span className="min-w-0 flex-1 truncate text-content-secondary">{match.label}</span>
            <span className="shrink-0 tabular-nums text-content-muted">{formatContinuityConfidence(match.score)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ConceptCatalog({ continuity }: { continuity: NonNullable<RunRecord["continuity"]> }): JSX.Element {
  const concepts = continuity.concepts;
  return (
    <ContinuitySubsection icon={Network} title="continuity.concepts">
      {concepts.length === 0 ? (
        <ContinuityEmptyText>{frontendMessage("continuity.emptyConcepts")}</ContinuityEmptyText>
      ) : (
        <ul className="space-y-2">
          {concepts.map((concept) => (
            <li key={concept.uri} className="min-w-0 border-l-2 border-line-subtle pl-2.5">
              <div className="flex min-w-0 items-baseline gap-2">
                <p className="min-w-0 flex-1 break-words text-[11px] leading-5 text-content-secondary">
                  {concept.label}
                </p>
                <span className="shrink-0 text-[9.5px] tabular-nums text-content-disabled">
                  {frontendMessage("continuity.conceptRecords", { count: concept.recordCount })}
                </span>
              </div>
              <p className="truncate text-[9.5px] leading-4 text-content-disabled" title={concept.aliases.join(", ")}>
                {concept.recordKinds.join(" / ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </ContinuitySubsection>
  );
}

function FactEvidence({ continuity }: { continuity: NonNullable<RunRecord["continuity"]> }): JSX.Element {
  const facts = continuity.factCatalog;
  return (
    <ContinuitySubsection icon={FileText} title="continuity.factCatalog">
      {facts.length === 0 ? (
        <ContinuityEmptyText>{frontendMessage("continuity.emptyFactCatalog")}</ContinuityEmptyText>
      ) : (
        <ul className="space-y-2">
          {facts.map((fact) => (
            <li key={fact.factKey} className="border-l-2 border-line-subtle pl-2.5">
              <p className="break-words text-[10.5px] leading-5 text-content-secondary">{fact.claim}</p>
              <RecallDetails sourceRefs={fact.sourceRefs} matchedBy={fact.matchedBy} identifier={fact.factKey} />
              {fact.validUntil ? (
                <p className="mt-0.5 text-[9.5px] leading-4 text-content-disabled">
                  {frontendMessage("continuity.validUntil")}: {formatDateTime(fact.validUntil)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </ContinuitySubsection>
  );
}

function SelectionSummary({
  selection,
}: {
  selection: NonNullable<RunRecord["continuity"]>["selection"];
}): JSX.Element {
  const ratio = selection.maxCharacters > 0 ? selection.usedCharacters / selection.maxCharacters : 0;
  return (
    <div aria-label={frontendMessage("continuity.selection")}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <SelectionCount label="continuity.selection.profile" value={selection.profiles} />
        <SelectionCount label="continuity.selection.fact" value={selection.facts} />
        {selection.relations ? (
          <SelectionCount label="continuity.selection.relation" value={selection.relations} />
        ) : null}
        <SelectionCount label="continuity.selection.event" value={selection.events} />
        <SelectionCount label="continuity.selection.evidence" value={selection.evidence} />
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-raised" aria-hidden="true">
        <div
          className="h-full rounded-full bg-accent-solid transition-[width] duration-300"
          style={{ width: `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%` }}
        />
      </div>
    </div>
  );
}

function SelectionCount({
  label,
  value,
}: {
  label: FrontendMessageKey;
  value: ContinuitySelectionCountData;
}): JSX.Element {
  return (
    <div className="min-w-0">
      <p className="text-[9.5px] leading-4 text-content-disabled">{frontendMessage(label)}</p>
      <p className="truncate text-[10px] tabular-nums leading-4 text-content-secondary">
        {frontendMessage("continuity.selection.count", {
          selected: value.selected,
          matched: value.matched,
          available: value.available,
        })}
      </p>
    </div>
  );
}

function RecallDiagnostics({ continuity }: { continuity: NonNullable<RunRecord["continuity"]> }): JSX.Element | null {
  const rejections = continuity.rejections;
  const nearMisses = continuity.nearMisses ?? [];
  if (!rejections && nearMisses.length === 0) return null;
  const rejectedTotal = rejections
    ? rejections.belowSimilarity + rejections.belowCandidate + rejections.funnelSkipped
    : 0;
  return (
    <ContinuitySubsection icon={Filter} title="continuity.recallFunnel">
      {rejections && rejectedTotal > 0 ? (
        <ul className="space-y-1">
          <RejectionRow label="continuity.rejection.belowSimilarity" count={rejections.belowSimilarity} />
          <RejectionRow label="continuity.rejection.belowCandidate" count={rejections.belowCandidate} />
          <RejectionRow label="continuity.rejection.funnelSkipped" count={rejections.funnelSkipped} />
        </ul>
      ) : null}
      {nearMisses.length === 0 ? (
        rejections ? (
          <ContinuityEmptyText>{frontendMessage("continuity.emptyNearMisses")}</ContinuityEmptyText>
        ) : null
      ) : (
        <ul className="space-y-2">
          {nearMisses.map((nearMiss, index) => (
            <li key={`${nearMiss.summary}:${index}`} className="border-l-2 border-line-subtle pl-2.5">
              <p className="break-words text-[10.5px] leading-5 text-content-secondary">{nearMiss.summary}</p>
              <p className="text-[9.5px] tabular-nums leading-4 text-content-disabled">
                {frontendMessage("continuity.nearMissScore", {
                  score: formatContinuityConfidence(nearMiss.score),
                  similarity: formatContinuityConfidence(nearMiss.textSimilarityScore),
                  lexical: formatContinuityConfidence(nearMiss.lexicalScore),
                  semantic: formatContinuityConfidence(nearMiss.semanticScore),
                })}
              </p>
              <p
                className="truncate text-[9.5px] leading-4 text-content-disabled"
                title={nearMiss.matchedBy.join(", ")}
              >
                {frontendMessage("continuity.matchMethods", { methods: nearMiss.matchedBy.join(", ") })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </ContinuitySubsection>
  );
}

function RejectionRow({ label, count }: { label: FrontendMessageKey; count: number }): JSX.Element | null {
  if (count <= 0) return null;
  return (
    <li className="flex items-baseline justify-between gap-2">
      <span className="min-w-0 flex-1 truncate text-[10px] leading-4 text-content-muted">
        {frontendMessage(label, { count })}
      </span>
    </li>
  );
}

function EventRecall({ continuity }: { continuity: NonNullable<RunRecord["continuity"]> }): JSX.Element {
  const candidates = continuity.eventCandidates;
  return (
    <ContinuitySubsection icon={Clock3} title="continuity.eventCandidates">
      {candidates.length === 0 ? (
        <ContinuityEmptyText>{frontendMessage("continuity.emptyEventCandidates")}</ContinuityEmptyText>
      ) : (
        <ul className="space-y-2">
          {candidates.map((entry, index) => (
            <li key={`${entry.sourceRefs.join(":")}:${index}`} className="border-l-2 border-line-subtle pl-2.5">
              <p className="break-words text-[10.5px] leading-5 text-content-secondary">{entry.summary}</p>
              <p className="text-[9.5px] leading-4 text-content-disabled">
                {formatDateTime(entry.occurredAt)} / {formatContinuityConfidence(entry.score)}
              </p>
              <RecallDetails sourceRefs={entry.sourceRefs} matchedBy={entry.matchedBy} />
            </li>
          ))}
        </ul>
      )}
    </ContinuitySubsection>
  );
}

function EvidenceRecall({ continuity }: { continuity: NonNullable<RunRecord["continuity"]> }): JSX.Element {
  const candidates = continuity.evidenceCandidates;
  return (
    <ContinuitySubsection icon={Link2} title="continuity.evidenceCandidates">
      {candidates.length === 0 ? (
        <ContinuityEmptyText>{frontendMessage("continuity.emptyEvidenceCandidates")}</ContinuityEmptyText>
      ) : (
        <ul className="space-y-2">
          {candidates.map((entry, index) => (
            <li key={`${entry.sourceRefs.join(":")}:${index}`} className="min-w-0 border-l-2 border-line-subtle pl-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[10.5px] leading-5 text-content-secondary">
                  {entry.sourceRefs.join(", ")}
                </span>
                <span className="shrink-0 text-[9.5px] tabular-nums text-content-disabled">
                  {formatContinuityConfidence(entry.score)}
                </span>
              </div>
              <p className="truncate text-[9.5px] leading-4 text-content-disabled" title={entry.matchedBy.join(", ")}>
                {frontendMessage("continuity.matchMethods", { methods: entry.matchedBy.join(", ") })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </ContinuitySubsection>
  );
}

function RecallDetails({
  sourceRefs,
  matchedBy,
  identifier,
}: {
  sourceRefs: readonly string[];
  matchedBy: readonly string[];
  identifier?: string;
}): JSX.Element {
  return (
    <details className="mt-1 text-[9.5px] leading-4 text-content-disabled">
      <summary className="cursor-pointer select-none truncate">
        {frontendMessage("continuity.matchMethods", { methods: matchedBy.join(", ") })}
      </summary>
      <div className="mt-1 min-w-0 border-l border-line-subtle pl-2">
        {identifier ? <p className="break-all">{identifier}</p> : null}
        {sourceRefs.map((sourceRef) => (
          <p key={sourceRef} className="break-all">
            {sourceRef}
          </p>
        ))}
      </div>
    </details>
  );
}
