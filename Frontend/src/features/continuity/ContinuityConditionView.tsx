import { Activity, BellRing, Clock3 } from "lucide-react";
import type { ContinuitySnapshotData } from "../../api/eventTypes";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import { cn, formatDateTime } from "../../lib/util";
import type { RunRecord } from "../../store/sessionStore";
import {
  ContinuityEmptyText,
  ContinuityGroup,
  ContinuitySubsection,
  formatContinuityScalar,
  formatContinuitySignalValue,
} from "./ContinuityPanelPrimitives";

export function ContinuityConditionView({ run }: { run: RunRecord }): JSX.Element {
  const continuity = run.continuity;
  if (!continuity) throw new Error("Continuity condition view requires a turn snapshot.");
  const rules = continuity.rules;
  const activeCount = rules.filter(
    (rule) => rule.maturity !== "candidate" && (rule.status === "partial" || rule.status === "triggered"),
  ).length;
  return (
    <ContinuityGroup
      id="conditions"
      icon={BellRing}
      title="continuity.group.conditions"
      summary={frontendMessage("continuity.ruleSummary", { active: activeCount, total: rules.length })}
    >
      <RuleList rules={rules} />
      <SignalList signals={continuity.signals} />
    </ContinuityGroup>
  );
}

function RuleList({ rules }: { rules: ContinuitySnapshotData["rules"] }): JSX.Element {
  return (
    <ContinuitySubsection icon={BellRing} title="continuity.conditions">
      {rules.length === 0 ? (
        <ContinuityEmptyText>{frontendMessage("continuity.emptyConditions")}</ContinuityEmptyText>
      ) : (
        <ul className="divide-y divide-line-subtle border-y border-line-subtle">
          {rules.map((rule) => (
            <li key={rule.uri} className="py-2.5 first:pt-2 last:pb-2" data-continuity-rule>
              <details
                className="group border-l border-line-subtle pl-2.5"
                open={rule.status === "partial" || rule.status === "triggered"}
              >
                <summary className="flex min-w-0 cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
                  <RuleStatusMark status={rule.status} />
                  <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium leading-5 text-content-primary">
                    {rule.title}
                  </span>
                  <span className="shrink-0 text-[9.5px] leading-4 text-content-muted">
                    {frontendMessage(ruleStatusMessageKey(rule.status))}
                  </span>
                </summary>
                <p className="mt-0.5 break-words text-[11px] leading-5 text-content-secondary">{rule.action}</p>
                <p className="mt-1 text-[9.5px] leading-4 text-content-muted">
                  {frontendMessage("continuity.ruleEvidence", { count: rule.supportCount })}
                  <span aria-hidden="true"> · </span>
                  {frontendMessage(ruleMaturityMessageKey(rule.maturity))}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-raised">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-300",
                        rule.truth === "true" ? "bg-moss-500" : "bg-accent-solid",
                      )}
                      style={{ width: `${Math.round(Math.max(0, Math.min(1, rule.score)) * 100)}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-[9.5px] tabular-nums leading-4 text-content-muted">
                    {formatRuleScore(rule.score, rule.threshold)}
                  </span>
                </div>
                {rule.conditions.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {rule.conditions.map((condition, conditionIndex) => (
                      <li
                        key={`${condition.label}:${conditionIndex}`}
                        className="flex min-w-0 items-start gap-1.5 text-[10px] leading-4 text-content-muted"
                      >
                        <ConditionTruthMark truth={condition.truth} />
                        <span className="min-w-0 flex-1 break-words">{condition.label}</span>
                        {condition.actual !== undefined ? (
                          <span className="max-w-[38%] shrink-0 truncate font-medium text-content-secondary">
                            {formatContinuityScalar(condition.actual)}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {rule.missingSignals.length > 0 ? (
                  <p className="mt-1.5 break-words text-[10px] leading-4 text-content-muted">
                    {frontendMessage("continuity.waiting")}: {rule.missingSignals.join(", ")}
                  </p>
                ) : null}
                {rule.validUntil ? (
                  <p className="mt-1 flex items-center gap-1 text-[9.5px] leading-4 text-content-disabled">
                    <Clock3 className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {frontendMessage("continuity.validUntil")}: {formatDateTime(rule.validUntil)}
                  </p>
                ) : null}
              </details>
            </li>
          ))}
        </ul>
      )}
    </ContinuitySubsection>
  );
}

function SignalList({ signals }: { signals: ContinuitySnapshotData["signals"] }): JSX.Element {
  return (
    <ContinuitySubsection icon={Activity} title="continuity.signals">
      {signals.length === 0 ? (
        <ContinuityEmptyText>{frontendMessage("continuity.emptySignals")}</ContinuityEmptyText>
      ) : (
        <ul className="space-y-2">
          {signals.map((signal) => (
            <li
              key={signal.uri}
              className="flex min-w-0 items-center gap-2 border-l-2 border-line-subtle pl-2.5"
              data-continuity-signal
            >
              <span className="min-w-0 flex-1 truncate text-[11px] leading-5 text-content-secondary">
                {signal.summary}
              </span>
              <span className="max-w-[45%] shrink-0 truncate text-[10.5px] font-medium leading-5 text-content-primary">
                {formatContinuitySignalValue(signal.valueJson)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ContinuitySubsection>
  );
}

function RuleStatusMark({ status }: { status: ContinuitySnapshotData["rules"][number]["status"] }): JSX.Element {
  const className =
    status === "triggered"
      ? "bg-moss-500"
      : status === "expired" || status === "cancelled"
        ? "bg-content-disabled"
        : status === "resolved"
          ? "bg-content-muted"
          : "bg-accent-solid";
  return <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", className)} aria-hidden="true" />;
}

function ConditionTruthMark({ truth }: { truth: "true" | "false" | "unknown" }): JSX.Element {
  const className = truth === "true" ? "bg-moss-500" : truth === "false" ? "bg-content-disabled" : "bg-content-muted";
  return <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", className)} aria-hidden="true" />;
}

function ruleStatusMessageKey(status: ContinuitySnapshotData["rules"][number]["status"]): FrontendMessageKey {
  return `continuity.status.${status}` as FrontendMessageKey;
}

function ruleMaturityMessageKey(maturity: ContinuitySnapshotData["rules"][number]["maturity"]): FrontendMessageKey {
  return `continuity.maturity.${maturity}` as FrontendMessageKey;
}

function formatRuleScore(score: number, threshold: number): string {
  return `${Math.round(score * 100)}% / ${Math.round(threshold * 100)}%`;
}
