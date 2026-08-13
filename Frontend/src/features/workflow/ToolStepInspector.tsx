import { useId, useState, type ReactNode } from "react";
import { Check, ChevronDown, Circle, LoaderCircle, X } from "lucide-react";
import { cn, formatDurationMs } from "../../lib/util";
import { frontendFeatureMessage } from "../../i18n/frontendFeatureMessageCatalog";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { TimelineStep } from "../../store/sessionStore";
import { Spinner } from "../../shared/ui/Spinner";
import { DataView } from "./DataView";
import { projectToolActivityInspection } from "./toolActivityPresentation";
import { readStepStatusLabel } from "./stepPresentation";
import { readWorkflowStepDurationMs } from "./workflowPresentationProjection";

export function ToolStepInspector({
  step,
  showHeader = true,
}: {
  step: TimelineStep;
  showHeader?: boolean;
}): JSX.Element {
  const activity = projectToolActivityInspection({
    toolName: step.toolName ?? step.title,
    origin: step.toolOrigin,
    arguments: step.toolArgs,
    status: step.status === "failed" ? "failed" : step.status === "done" ? "completed" : "active",
  });
  const result = readResultSummary(step);
  const changes = step.toolPresentation?.changes ?? [];
  const durationMs = readWorkflowStepDurationMs(step);

  return (
    <div className="min-w-0" data-tool-step-inspector>
      {showHeader ? (
        <header className="border-b border-line-subtle px-4 pb-3 pt-3.5">
          <div className="flex min-w-0 items-start gap-2.5">
            <InspectorStatusIcon status={step.status} />
            <div className="min-w-0 flex-1">
              <h3 className="break-words text-[13.5px] font-medium leading-5 text-content-primary">{activity.label}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10.5px] leading-4 text-content-muted">
                <span>{readStepStatusLabel(step.status)}</span>
                {step.toolName ? <span>{step.toolName}</span> : null}
                {durationMs !== undefined ? (
                  <span className="font-mono tabular-nums">{formatDurationMs(durationMs)}</span>
                ) : null}
              </div>
            </div>
          </div>
        </header>
      ) : null}

      <div className="divide-y divide-line-subtle px-4">
        <InspectorSection
          label={frontendFeatureMessage(step.purpose ? "workflow.inspector.purpose" : "workflow.inspector.action")}
        >
          <p className="whitespace-pre-wrap break-words text-[12.5px] leading-5 text-content-secondary">
            {step.purpose ?? activity.label}
          </p>
        </InspectorSection>

        {activity.subjects.length > 0 ? (
          <InspectorSection label={frontendFeatureMessage("workflow.inspector.scope")}>
            <ul className="space-y-1" data-tool-inspector-subjects>
              {activity.subjects.map((subject) => (
                <li key={subject} className="break-all font-mono text-[11.5px] leading-5 text-content-primary">
                  {subject}
                </li>
              ))}
            </ul>
          </InspectorSection>
        ) : null}

        {result ? (
          <InspectorSection label={frontendFeatureMessage("workflow.inspector.result")}>
            <p
              className={cn(
                "whitespace-pre-wrap break-words text-[12.5px] leading-5",
                step.status === "failed" ? "text-brick-600" : "text-content-secondary",
              )}
            >
              {result}
            </p>
          </InspectorSection>
        ) : null}

        {changes.length > 0 ? (
          <InspectorSection label={frontendFeatureMessage("workflow.inspector.changes")}>
            <div className="divide-y divide-line-subtle" data-tool-inspector-changes>
              {changes.map((change, index) => (
                <div key={`${change.kind}:${change.key}:${index}`} className="flex min-w-0 items-baseline gap-3 py-1.5">
                  <span className="min-w-0 flex-1 break-all font-mono text-[11.5px] text-content-primary">
                    {change.key}
                  </span>
                  <LineChangeStats added={change.addedLines} removed={change.removedLines} />
                </div>
              ))}
            </div>
          </InspectorSection>
        ) : null}

        {hasTechnicalDetails(step) ? <ToolTechnicalDetails step={step} /> : null}
      </div>
    </div>
  );
}

function InspectorSection({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <section className="grid grid-cols-[5.25rem_minmax(0,1fr)] gap-3 py-3" data-tool-inspector-section>
      <h4 className="pt-0.5 text-[10.5px] font-medium text-content-muted">{label}</h4>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function LineChangeStats({ added, removed }: { added?: number; removed?: number }): JSX.Element | null {
  if (added === undefined && removed === undefined) return null;
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] tabular-nums" data-line-change-stats>
      <span className="text-moss-600">+{added ?? 0}</span>
      <span className="text-brick-600">-{removed ?? 0}</span>
    </span>
  );
}

function ToolTechnicalDetails({ step }: { step: TimelineStep }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  return (
    <section className="py-2" data-workflow-technical-details>
      <button
        type="button"
        className="group flex min-h-8 w-full items-center gap-2 text-left text-[11.5px] font-medium text-content-muted transition-colors hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="flex-1">{frontendFeatureMessage("workflow.node.technicalDetails")}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
      </button>
      {expanded ? (
        <div id={contentId} className="space-y-4 border-l border-line-subtle pb-2 pl-3 pt-2">
          {step.callId ? <TechnicalValue label="callId" value={step.callId} mono /> : null}
          {step.toolArgs !== undefined ? (
            <TechnicalData label={frontendMessage("workflow.node.section.toolArgs")} value={step.toolArgs} />
          ) : null}
          {step.toolProgress ? (
            <TechnicalData label={frontendMessage("workflow.node.section.toolProgress")} value={step.toolProgress} />
          ) : null}
          {step.toolOutput?.stdout ? <OutputBlock stream="stdout" value={step.toolOutput.stdout} /> : null}
          {step.toolOutput?.stderr ? <OutputBlock stream="stderr" value={step.toolOutput.stderr} /> : null}
          {step.toolResult !== undefined ? (
            <TechnicalData label={frontendMessage("workflow.node.section.rawToolResult")} value={step.toolResult} />
          ) : null}
          {step.detailJson !== undefined ? (
            <TechnicalData label={frontendMessage("workflow.node.section.actionDetails")} value={step.detailJson} />
          ) : null}
          {step.toolPresentation?.artifactUri ? (
            <TechnicalValue
              label={frontendMessage("workflow.node.section.archive")}
              value={step.toolPresentation.artifactUri}
              mono
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function TechnicalData({ label, value }: { label: string; value: unknown }): JSX.Element {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 text-[10px] font-medium text-content-muted">{label}</div>
      <DataView value={value} />
    </div>
  );
}

function TechnicalValue({ label, value, mono = false }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2 text-[11px]">
      <span className="text-content-muted">{label}</span>
      <span className={cn("break-all text-content-secondary", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function OutputBlock({ stream, value }: { stream: "stdout" | "stderr"; value: string }): JSX.Element {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[10px] uppercase text-content-muted">{stream}</div>
      <pre className="scrollbar-thin max-h-56 overflow-auto whitespace-pre-wrap break-words border-l-2 border-line px-3 py-1 font-mono text-[11px] leading-5 text-content-secondary">
        {value}
      </pre>
    </div>
  );
}

function InspectorStatusIcon({ status }: { status: TimelineStep["status"] }): JSX.Element {
  const className = "mt-0.5 h-4 w-4 shrink-0";
  if (status === "running") return <Spinner size="sm" className={cn(className, "text-accent-content")} />;
  if (status === "cancelling") return <LoaderCircle className={cn(className, "animate-spin text-accent-content")} />;
  if (status === "failed") return <X className={cn(className, "text-brick-600")} />;
  if (status === "done") return <Check className={cn(className, "text-moss-600")} />;
  return <Circle className={cn(className, "text-content-muted")} />;
}

function readResultSummary(step: TimelineStep): string | undefined {
  if (step.toolErrorMessage) return step.toolErrorMessage;
  const placeholders = new Set([step.toolName?.trim(), step.title.trim()].filter(Boolean));
  return [step.toolPresentation?.summary, step.toolPresentation?.headline, step.toolPreview]
    .map((value) => value?.trim())
    .find((value): value is string => Boolean(value && !placeholders.has(value)));
}

function hasTechnicalDetails(step: TimelineStep): boolean {
  return Boolean(
    step.callId ||
    step.toolArgs !== undefined ||
    step.toolProgress ||
    step.toolOutput?.stdout ||
    step.toolOutput?.stderr ||
    step.toolResult !== undefined ||
    step.detailJson !== undefined ||
    step.toolPresentation?.artifactUri,
  );
}
