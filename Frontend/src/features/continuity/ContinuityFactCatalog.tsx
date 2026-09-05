import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { RunRecord } from "../../store/sessionStore";
import { ContinuityEmptyText, ContinuitySubsection, formatContinuityConfidence } from "./ContinuityPanelPrimitives";

export function ContinuityFactCatalog({
  continuity,
}: {
  continuity: NonNullable<RunRecord["continuity"]>;
}): JSX.Element {
  const facts = continuity.factCatalog;
  return (
    <ContinuitySubsection title="continuity.factCatalog">
      {facts.length === 0 ? (
        <ContinuityEmptyText>{frontendMessage("continuity.emptyFactCatalog")}</ContinuityEmptyText>
      ) : (
        <ul className="divide-y divide-line-subtle border-y border-line-subtle">
          {facts.map((fact, index) => (
            <li key={fact.factKey} className="py-2.5 first:pt-2 last:pb-2" data-continuity-entry>
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 font-mono text-[9px] tabular-nums text-content-disabled">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span
                  className="min-w-0 truncate font-mono text-[9px] leading-4 text-content-muted"
                  title={fact.factKey}
                >
                  {fact.factKey}
                </span>
              </div>
              <p className="mt-1 break-words pl-7 text-[11px] leading-5 text-content-primary">{fact.claim}</p>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-7 text-[9.5px] tabular-nums leading-4 text-content-muted">
                <span>
                  {frontendMessage("continuity.recallScore", { score: formatContinuityConfidence(fact.score) })}
                </span>
                <span aria-hidden="true">/</span>
                <span>{formatContinuityConfidence(fact.confidence)}</span>
                {fact.supportCount !== undefined && fact.supportMass !== undefined ? (
                  <>
                    <span aria-hidden="true">/</span>
                    <span>
                      {frontendMessage("continuity.factEvidence", {
                        count: fact.supportCount,
                        mass: formatContinuityConfidence(fact.supportMass),
                      })}
                    </span>
                  </>
                ) : null}
                {fact.maturity ? (
                  <>
                    <span aria-hidden="true">/</span>
                    <span>{frontendMessage(`continuity.maturity.${fact.maturity}` as const)}</span>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </ContinuitySubsection>
  );
}
