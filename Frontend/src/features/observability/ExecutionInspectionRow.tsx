import { frontendFeatureMessage as t } from "../../i18n/frontendFeatureMessageCatalog";
import { formatDurationMs, formatInteger } from "../../lib/util";
import { ActivityStatusIcon, AppIcon, Button, IconButton } from "../../shared/ui";
import { ToolStepInspector } from "../workflow/ToolStepInspector";
import { DataView } from "../workflow/DataView";
import { readStepStatusLabel } from "../workflow/stepPresentation";
import { readWorkflowStepDurationMs } from "../workflow/workflowPresentationProjection";
import { useChildRunNavigation } from "../workflow/ChildRunNavigation";
import { requestContextUsage } from "./contextInspectionModel";
import {
  executionStepSummary,
  executionToolSummary,
  type ExecutionInspectionRow as Row,
} from "./executionInspectionModel";
import { AgentToolPresentationIcon } from "../../shared/workspace/AgentToolPresentationIcon";
import { readRunInputLabel } from "../../store/session/runInputLabel";

type StepRow = Extract<Row, { kind: "step" }>;

export function executionRecordTitle(row: StepRow): string {
  if (row.step.kind === "model") return t("insights.process.request", { index: row.request ?? 1 });
  if (row.step.childRun) return row.step.childRun.taskLabel ?? t("insights.process.agentTask");
  return executionToolSummary(row.step)?.label ?? row.step.title;
}

export function ExecutionInspectionRow({
  row,
  open,
  onToggle,
  onToggleParallel,
}: {
  row: Row;
  open: boolean;
  onToggle: () => void;
  onToggleParallel: () => void;
}): JSX.Element {
  if (row.kind === "turn")
    return (
      <header className="insights-execution-turn">
        <button type="button" onClick={onToggle} aria-expanded={!row.collapsed}>
          <AppIcon icon="chevron-right" size={11} className={row.collapsed ? undefined : "rotate-90"} />
          <b>{t("insights.turn", { index: row.turn })}</b>
          <span className="insights-execution-turn-input" title={readRunInputLabel(row.run)}>
            {readRunInputLabel(row.run)}
          </span>
          {row.failed ? (
            <span className="insights-execution-batch-failed">
              {t("insights.process.failures", { count: row.failed })}
            </span>
          ) : null}
          <span>{t("insights.process.turnSummary", { requests: row.requests, tools: row.tools })}</span>
        </button>
      </header>
    );
  if (row.kind === "scope")
    return (
      <div className="insights-execution-scope">
        <AppIcon icon="users" size={11} />
        {row.label}
      </div>
    );
  const { step, parallel } = row;
  const duration = readWorkflowStepDurationMs(step);
  const tool = step.callId ? executionToolSummary(step) : undefined;
  const usage = step.kind === "model" ? requestContextUsage(step) : undefined;
  const kind = step.kind === "model" ? "model" : step.childRun ? "agent" : step.callId ? "tool" : "event";
  const title = executionRecordTitle(row);
  const target = step.kind === "model" ? step.modelName : [tool?.subject, tool?.detail].filter(Boolean).join(" · ");
  const summary = executionStepSummary(step);
  const outcome =
    step.status === "failed"
      ? summary
      : usage
        ? t("insights.process.inputSize", {
            count: `${usage.source === "local_estimate" ? "≈" : ""}${formatInteger(usage.tokens)}`,
          })
        : summary;
  return (
    <article
      className="insights-execution-entry"
      data-kind={kind}
      data-status={step.status}
      data-selected={open || undefined}
      data-inspection-step={step.id}
    >
      <div className="insights-record-row">
        <button
          type="button"
          className="insights-record-primary"
          aria-pressed={open}
          onClick={onToggle}
          aria-label={[
            title,
            target,
            outcome,
            readStepStatusLabel(step.status),
            duration === undefined ? undefined : formatDurationMs(duration),
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          <span className="insights-execution-glyph" aria-hidden="true">
            {step.callId ? (
              <AgentToolPresentationIcon icon={step.toolOrigin?.presentation?.icon ?? "tools"} size={13} />
            ) : (
              <AppIcon icon={kind === "agent" ? "users" : kind === "model" ? "thinking" : "activity"} size={13} />
            )}
          </span>
          <span className="insights-record-action" title={[title, target].filter(Boolean).join(" · ")}>
            <b>{title}</b>
            {target ? <span>{target}</span> : null}
          </span>
        </button>
        <span className="insights-record-result">
          {parallel ? (
            <button
              type="button"
              className="insights-record-parallel"
              onClick={onToggleParallel}
              aria-expanded={!parallel.collapsed}
              aria-label={t("insights.process.parallelGroup", { count: parallel.count })}
              title={t("insights.process.parallelGroup", { count: parallel.count })}
            >
              <AppIcon icon="chevron-right" size={10} className={parallel.collapsed ? undefined : "rotate-90"} />
              <span>{t("insights.process.parallelCount", { count: parallel.count })}</span>
              {parallel.failed ? (
                <span className="insights-execution-batch-failed">
                  {t("insights.process.failures", { count: parallel.failed })}
                </span>
              ) : null}
              {parallel.active ? (
                <ActivityStatusIcon
                  status="running"
                  size={11}
                  motion="spin"
                  aria-label={readStepStatusLabel("running")}
                />
              ) : null}
            </button>
          ) : null}
          <span className="insights-record-summary" title={outcome}>
            {outcome}
          </span>
        </span>
        <span
          className="insights-execution-outcome"
          data-outcome={step.status}
          title={readStepStatusLabel(step.status)}
          aria-label={readStepStatusLabel(step.status)}
        >
          <ActivityStatusIcon status={step.status} size={12} motion="spin" />
        </span>
        <time className="insights-record-time">{duration === undefined ? "—" : formatDurationMs(duration)}</time>
      </div>
    </article>
  );
}

/** The inspector has its own scroll area; opening a result never changes ledger row heights. */
export function ExecutionInspectionDetail({
  row,
  onClose,
  onInspectRequest,
}: {
  row: StepRow;
  onClose: () => void;
  onInspectRequest: (id: string) => void;
}): JSX.Element {
  const childNavigation = useChildRunNavigation();
  const { step } = row;
  return (
    <section className="insights-execution-inspector" aria-label={t("insights.process.recordDetail")}>
      <header>
        <b>{executionRecordTitle(row)}</b>
        <span>{readStepStatusLabel(step.status)}</span>
        <IconButton label={t("insights.process.closeDetail")} size="sm" tone="muted" onClick={onClose}>
          <AppIcon icon="close" size={13} />
        </IconButton>
      </header>
      <div className="insights-execution-detail" key={step.id}>
        {step.kind === "tool" ? (
          <ToolStepInspector step={step} showHeader={false} />
        ) : (
          <>
            {step.modelName ? <p className="insights-note">{step.modelName}</p> : null}
            {step.description ? <p>{step.description}</p> : null}
            {step.kind === "model" ? (
              <Button variant="ghost" size="sm" onClick={() => onInspectRequest(step.id)}>
                {t("insights.process.inspectContext")}
                <AppIcon icon="arrow-right" size={13} />
              </Button>
            ) : null}
            {step.childRun && childNavigation ? (
              <Button variant="ghost" size="sm" onClick={() => childNavigation.open(step.childRun!.id)}>
                {t("insights.process.inspectChild")}
                <AppIcon icon="arrow-right" size={13} />
              </Button>
            ) : null}
            {step.detailJson === undefined ? null : <DataView value={step.detailJson} />}
            {step.errorMessage ? <p className="text-brick-600">{step.errorMessage}</p> : null}
          </>
        )}
      </div>
    </section>
  );
}
