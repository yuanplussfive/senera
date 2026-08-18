import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn, formatDurationMs } from "../../lib/util";
import { frontendFeatureMessage } from "../../i18n/frontendFeatureMessageCatalog";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { TimelineStep } from "../../store/sessionStore";
import { DataView } from "./DataView";
import { projectToolStagePresentation } from "./toolStagePresentation";
import { readStepStatusLabel } from "./stepPresentation";
import { readWorkflowStepDurationMs } from "./workflowPresentationProjection";
import { ToolActionIcon } from "./ToolActionIcon";

export function ToolStepInspector({
  step,
  showHeader = true,
}: {
  step: TimelineStep;
  showHeader?: boolean;
}): JSX.Element {
  const toolName = step.toolName?.trim() || step.title;
  const result = readToolResult(step);
  const durationMs = readWorkflowStepDurationMs(step);
  const stagePresentation = projectToolStagePresentation({ steps: [step] });

  return (
    <div className="min-w-0" data-tool-step-inspector>
      {showHeader ? (
        <header className="border-b border-line-subtle px-4 pb-3 pt-3.5">
          <div className="flex min-w-0 items-start gap-2.5">
            <ToolActionIcon icon={stagePresentation?.icon ?? "tools"} status={step.status} className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <h3 className="break-words font-mono text-[13px] font-medium leading-5 text-content-primary">
                {toolName}
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10.5px] leading-4 text-content-muted">
                <span>{readStepStatusLabel(step.status)}</span>
                {durationMs !== undefined ? (
                  <span className="font-mono tabular-nums">{formatDurationMs(durationMs)}</span>
                ) : null}
              </div>
            </div>
          </div>
        </header>
      ) : null}

      <div className="divide-y divide-line-subtle px-4">
        <InspectorSection label={frontendFeatureMessage("workflow.inspector.action")} testId="action">
          <DataView value={step.toolArgs ?? {}} />
        </InspectorSection>

        {result !== undefined ? (
          <InspectorSection label={frontendFeatureMessage("workflow.inspector.result")} testId="result">
            <div className={step.status === "failed" ? "text-brick-600" : undefined}>
              <DataView value={result} />
            </div>
          </InspectorSection>
        ) : null}

        {hasTechnicalDetails(step) ? <ToolTechnicalDetails step={step} /> : null}
      </div>
    </div>
  );
}

function InspectorSection({
  label,
  children,
  testId,
}: {
  label: string;
  children: ReactNode;
  testId?: string;
}): JSX.Element {
  return (
    <section className="grid grid-cols-[5.25rem_minmax(0,1fr)] gap-3 py-3" data-tool-inspector-section={testId}>
      <h4 className="pt-0.5 text-[10.5px] font-medium text-content-muted">{label}</h4>
      <div className="min-w-0">{children}</div>
    </section>
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
          {step.toolProgress ? (
            <TechnicalData label={frontendMessage("workflow.node.section.toolProgress")} value={step.toolProgress} />
          ) : null}
          {step.toolOutput?.stdout ? <OutputBlock stream="stdout" value={step.toolOutput.stdout} /> : null}
          {step.toolOutput?.stderr ? <OutputBlock stream="stderr" value={step.toolOutput.stderr} /> : null}
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

function readToolResult(step: TimelineStep): unknown {
  if (step.toolResult !== undefined) return unwrapExecutionResult(step, step.toolResult);
  if (step.toolOutput?.stdout || step.toolOutput?.stderr) {
    return {
      ...(step.toolOutput.stdout ? { stdout: step.toolOutput.stdout } : {}),
      ...(step.toolOutput.stderr ? { stderr: step.toolOutput.stderr } : {}),
    };
  }
  if (step.toolErrorMessage) return { error: step.toolErrorMessage };
  return undefined;
}

/**
 * Detailed lifecycle events may carry an execution envelope alongside the raw
 * tool response. Detect it by the call identity rather than by a tool-specific
 * result shape, so custom tools can still return an ordinary `result` property.
 */
function unwrapExecutionResult(step: TimelineStep, value: unknown): unknown {
  if (!isRecord(value) || !("result" in value)) return value;
  if (typeof value.callId !== "string" || typeof value.name !== "string") return value;
  if (step.callId && value.callId !== step.callId) return value;
  if (step.toolName && value.name !== step.toolName) return value;
  if (!("arguments" in value || "outcome" in value || "presentation" in value)) return value;
  return value.result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasTechnicalDetails(step: TimelineStep): boolean {
  return Boolean(
    step.callId ||
    step.toolProgress ||
    step.toolOutput?.stdout ||
    step.toolOutput?.stderr ||
    step.detailJson !== undefined ||
    step.toolPresentation?.artifactUri,
  );
}
