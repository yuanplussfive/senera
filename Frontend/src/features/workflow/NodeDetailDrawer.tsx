import { memo, useCallback, useEffect, useId, useState } from "react";
import { X, Copy, Check, ChevronDown } from "lucide-react";
import type { TimelineChildRunMessage, TimelineStep } from "../../store/sessionStore";
import { friendlyDecisionKind } from "../../store/sessionStore";
import { cn, formatTime, formatDurationMs } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { frontendFeatureMessage } from "../../i18n/frontendFeatureMessageCatalog";
import { MotionIconSwap } from "../../shared/motion";
import { MarkdownRenderer } from "../../shared/code/MarkdownRenderer";
import { MetaLabel, Sheet, SheetContent, Skeleton, Tooltip, useClipboardCopy } from "../../shared/ui";
import { readStepKindLabel, readStepStatusLabel } from "./stepPresentation";
import { DataView } from "./DataView";
import { ChildRunOverview } from "./ChildRunOverview";
import { readWorkflowStepDurationMs } from "./workflowPresentationProjection";

export interface NodeDetailDrawerProps {
  step: TimelineStep | null;
  onClose: () => void;
}

export function NodeDetailDrawer({ step, onClose }: NodeDetailDrawerProps): JSX.Element {
  const [contentReady, setContentReady] = useState(false);
  const stepId = step?.id;

  useEffect(() => {
    setContentReady(false);
    if (!stepId) return;
    const id = window.requestAnimationFrame(() => setContentReady(true));
    return () => window.cancelAnimationFrame(id);
  }, [stepId]);

  return (
    <Sheet
      open={!!step}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        title={step?.title ?? frontendMessage("workflow.node.detailFallbackTitle")}
        className="w-[min(560px,90vw)] p-0"
        deferContentMount={false}
        showClose={false}
        showHeader={false}
      >
        {step ? (
          <>
            <Header step={step} onClose={onClose} />
            <div className="scrollbar-thin flex-1 overflow-y-auto px-5 pb-8 pt-3">
              {contentReady ? <WorkflowStepDetail step={step} /> : <DetailSkeleton />}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-4" role="status" aria-busy="true" aria-label={frontendMessage("ui.loading")}>
      <div className="space-y-2 border-y border-ink-200/60 py-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-40" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  );
}

function Header({ step, onClose }: { step: TimelineStep; onClose: () => void }): JSX.Element {
  return (
    <div className="flex h-14 items-center gap-2 border-b border-ink-200/60 px-5">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[15px] font-semibold text-ink-950">{step.title}</h2>
        <div className="mt-0.5 text-[10.5px] text-ink-500">{readStepKindLabel(step.kind)}</div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="ml-auto grid h-8 w-8 place-items-center rounded-md text-ink-500 transition hover:bg-ink-900/[0.05] hover:text-ink-800"
        aria-label={frontendMessage("ui.close")}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export const WorkflowStepDetail = memo(function WorkflowStepDetail({ step }: { step: TimelineStep }): JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <MetaStrip step={step} />

      {step.childRun ? <ChildRunOverview childRun={step.childRun} /> : null}

      {step.childRun ? <ChildRunMessages messages={step.childRun.messages ?? []} /> : null}

      {step.description ? (
        <Section label={frontendMessage("workflow.node.section.description")}>
          <MarkdownRenderer contentClassName="text-[13.5px] leading-relaxed" compact lightweightCode>
            {step.description}
          </MarkdownRenderer>
        </Section>
      ) : null}

      {step.toolErrorMessage ? (
        <Section label={frontendMessage("workflow.node.section.error")}>
          <div className="whitespace-pre-wrap break-words text-[13px] leading-5 text-brick-600">
            {step.toolErrorMessage}
          </div>
        </Section>
      ) : null}
      {step.errorMessage && step.errorMessage !== step.toolErrorMessage ? (
        <Section label={frontendMessage("workflow.node.section.error")}>
          <div className="whitespace-pre-wrap break-words text-[13px] leading-5 text-brick-600">
            {step.errorMessage}
          </div>
        </Section>
      ) : null}

      {step.toolArgs !== undefined ? (
        <Section label={frontendMessage("workflow.node.section.toolArgs")} copyValue={step.toolArgs}>
          <DataCard>
            <DataView value={step.toolArgs} />
          </DataCard>
        </Section>
      ) : null}

      {step.toolProgress ? (
        <Section label={frontendMessage("workflow.node.section.toolProgress")} copyValue={step.toolProgress}>
          <DataCard>
            <DataView value={step.toolProgress} />
          </DataCard>
        </Section>
      ) : null}

      {step.toolOutput && (step.toolOutput.stdout || step.toolOutput.stderr) ? (
        <Section label={frontendMessage("workflow.node.section.toolOutput")} copyValue={step.toolOutput}>
          <div className="space-y-2">
            {step.toolOutput.stdout ? <ToolOutputBlock stream="stdout" text={step.toolOutput.stdout} /> : null}
            {step.toolOutput.stderr ? <ToolOutputBlock stream="stderr" text={step.toolOutput.stderr} /> : null}
          </div>
        </Section>
      ) : null}

      {step.toolPreview && step.toolPreview !== step.toolPresentation?.headline ? (
        <Section label={frontendMessage("workflow.node.section.resultPreview")} copyValue={step.toolPreview}>
          <MarkdownRenderer
            className="px-0 py-0"
            contentClassName="text-[13px] leading-relaxed"
            compact
            lightweightCode
          >
            {step.toolPreview}
          </MarkdownRenderer>
        </Section>
      ) : null}

      {step.toolPresentation ? <ToolResultSummary presentation={step.toolPresentation} /> : null}

      {hasTechnicalDetails(step) ? <TechnicalDetails key={step.id} step={step} /> : null}
    </div>
  );
});

const ChildRunMessageKindLabels: Record<TimelineChildRunMessage["kind"], Parameters<typeof frontendMessage>[0]> = {
  decision: "workflow.childRun.message.decision",
  follow_up: "workflow.childRun.message.followUp",
  progress: "workflow.childRun.message.progress",
  response: "workflow.childRun.message.response",
  steering: "workflow.childRun.message.steering",
};

function ChildRunMessages({ messages }: { messages: readonly TimelineChildRunMessage[] }): JSX.Element {
  const copyValue = messages
    .map((message) => {
      const direction =
        message.direction === "child_to_parent"
          ? frontendMessage("workflow.childRun.message.child")
          : frontendMessage("workflow.childRun.message.parent");
      return `${direction} · ${frontendMessage(ChildRunMessageKindLabels[message.kind])}\n${message.content}`;
    })
    .join("\n\n");

  return (
    <Section label={frontendMessage("workflow.node.section.childMessages")} copyValue={copyValue || undefined}>
      {messages.length > 0 ? (
        <div className="divide-y divide-line-subtle border-y border-line-subtle" data-child-run-messages>
          {messages.map((message) => (
            <article
              key={message.id}
              className={cn(
                "border-l-2 px-3 py-3",
                message.direction === "child_to_parent" ? "border-accent-content" : "border-umber-400",
              )}
            >
              <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px]">
                <span className="font-medium text-content-primary">
                  {message.direction === "child_to_parent"
                    ? frontendMessage("workflow.childRun.message.child")
                    : frontendMessage("workflow.childRun.message.parent")}
                </span>
                <span className="text-content-muted">{frontendMessage(ChildRunMessageKindLabels[message.kind])}</span>
              </div>
              <MarkdownRenderer
                className="px-0 py-0"
                contentClassName="text-[13px] leading-relaxed"
                compact
                lightweightCode
              >
                {message.content}
              </MarkdownRenderer>
            </article>
          ))}
        </div>
      ) : (
        <div className="border-y border-line-subtle py-3 text-[12.5px] leading-5 text-content-secondary">
          {frontendMessage("workflow.childRun.message.empty")}
        </div>
      )}
    </Section>
  );
}

function ToolOutputBlock({ stream, text }: { stream: "stdout" | "stderr"; text: string }): JSX.Element {
  return (
    <div className="overflow-hidden rounded-md border border-ink-200/70 bg-ink-950 text-paper-100">
      <div className="border-b border-white/10 px-3 py-1 font-mono text-[10px] uppercase text-paper-300">{stream}</div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-relaxed">
        {text}
      </pre>
    </div>
  );
}

function ToolResultSummary({
  presentation,
}: {
  presentation: NonNullable<TimelineStep["toolPresentation"]>;
}): JSX.Element {
  const summary = presentation.summary || presentation.headline;
  if (!summary) return <></>;

  return (
    <Section label={frontendMessage("workflow.node.section.resultSummary")} copyValue={summary}>
      <MarkdownRenderer className="px-0 py-0" contentClassName="text-[13px] leading-relaxed" compact lightweightCode>
        {summary}
      </MarkdownRenderer>
    </Section>
  );
}

function TechnicalDetails({ step }: { step: TimelineStep }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();

  return (
    <section className="border-t border-line-subtle pt-2" data-workflow-technical-details>
      <button
        type="button"
        className="flex min-h-8 w-full items-center gap-2 rounded px-1 text-left text-[12px] font-medium text-content-secondary transition-colors hover:bg-surface-hover hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="flex-1">{frontendFeatureMessage("workflow.node.technicalDetails")}</span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 text-content-muted transition-transform", expanded && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {expanded ? (
        <div id={contentId} className="mt-3 flex flex-col gap-5 border-l border-line-subtle pl-3">
          {step.toolPresentation ? <ToolResultTechnicalDetails presentation={step.toolPresentation} /> : null}
          {step.toolResult !== undefined ? (
            <Section label={frontendMessage("workflow.node.section.rawToolResult")} copyValue={step.toolResult}>
              <DataCard>
                <DataView value={step.toolResult} />
              </DataCard>
            </Section>
          ) : null}
          {step.detailJson !== undefined ? (
            <Section label={frontendMessage("workflow.node.section.actionDetails")} copyValue={step.detailJson}>
              <DataCard>
                <DataView value={step.detailJson} />
              </DataCard>
            </Section>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ToolResultTechnicalDetails({
  presentation,
}: {
  presentation: NonNullable<TimelineStep["toolPresentation"]>;
}): JSX.Element {
  const facts = presentation.facts.map((fact) => ({
    name: fact.name,
    value: fact.value,
    kind: fact.kind,
    evidenceUri: fact.evidenceUri,
    confidence: fact.confidence,
  }));
  const evidence = presentation.evidence.map((item) => ({
    display: item.display,
    label: item.label,
    kind: item.kind,
    locator: item.locator,
    source: item.source,
    evidenceUri: item.evidenceUri,
    confidence: item.confidence,
  }));
  const changes = presentation.changes.map((change) => ({
    status: change.status,
    path: change.key,
    summary: change.summary,
    kind: change.kind,
  }));

  return (
    <>
      {facts.length > 0 ? (
        <Section label={frontendMessage("workflow.node.section.facts")} copyValue={facts}>
          <DataCard>
            <DataView value={facts} />
          </DataCard>
        </Section>
      ) : null}

      {evidence.length > 0 ? (
        <Section label={frontendMessage("workflow.node.section.evidence")} copyValue={evidence}>
          <DataCard>
            <DataView value={evidence} />
          </DataCard>
        </Section>
      ) : null}

      {changes.length > 0 ? (
        <Section label={frontendMessage("workflow.node.section.changes")} copyValue={changes}>
          <DataCard>
            <DataView value={changes} />
          </DataCard>
        </Section>
      ) : null}

      {presentation.artifactUri ? (
        <Section label={frontendMessage("workflow.node.section.archive")} copyValue={presentation.artifactUri}>
          <span className="break-all font-mono text-[12px] text-ink-500">{presentation.artifactUri}</span>
        </Section>
      ) : null}
    </>
  );
}

function hasTechnicalDetails(step: TimelineStep): boolean {
  const presentation = step.toolPresentation;
  return Boolean(
    step.toolResult !== undefined ||
    step.detailJson !== undefined ||
    presentation?.artifactUri ||
    presentation?.facts.length ||
    presentation?.evidence.length ||
    presentation?.changes.length,
  );
}

function MetaStrip({ step }: { step: TimelineStep }): JSX.Element {
  const chips: Array<{ label: string; value: string; mono?: boolean; tone?: "default" | "warn" | "ok" | "live" }> = [];
  chips.push({
    label: frontendMessage("workflow.node.meta.status"),
    value: readStepStatusLabel(step.status),
    tone: step.status === "failed" ? "warn" : step.status === "running" ? "live" : "default",
  });
  if (step.modelName)
    chips.push({ label: frontendMessage("workflow.node.meta.model"), value: step.modelName, mono: true });
  if (step.toolName) chips.push({ label: frontendMessage("workflow.node.meta.tool"), value: step.toolName });
  if (step.scope?.workflowName) chips.push({ label: "Workflow", value: step.scope.workflowName });
  if (step.scope?.agentName) chips.push({ label: "Agent", value: step.scope.agentName });
  if (step.scope?.role === "merge")
    chips.push({
      label: frontendMessage("workflow.node.meta.stage"),
      value: frontendMessage("workflow.node.stage.merge"),
    });
  if (step.decisionKind)
    chips.push({ label: frontendMessage("workflow.node.meta.action"), value: friendlyDecisionKind(step.decisionKind) });
  if (step.callId) chips.push({ label: "callId", value: step.callId.slice(0, 14), mono: true });
  if (typeof step.retryAttempt === "number")
    chips.push({
      label: frontendMessage("workflow.node.meta.retry"),
      value: frontendMessage("workflow.node.retryAttempt", { attempt: step.retryAttempt }),
      tone: "warn",
    });
  if (typeof step.promptChars === "number") {
    chips.push({
      label: frontendMessage("workflow.node.meta.prompt"),
      value: [
        frontendMessage("workflow.node.charCount", { count: step.promptChars }),
        frontendMessage("workflow.node.lineCount", { count: step.promptLines ?? 0 }),
        typeof step.promptTokenCount === "number" ? `${step.promptTokenCount} token` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }
  const durationMs = readWorkflowStepDurationMs(step);
  if (durationMs !== undefined)
    chips.push({
      label: frontendMessage("workflow.node.meta.duration"),
      value: formatDurationMs(durationMs),
      mono: true,
    });
  else if (step.startedAt)
    chips.push({ label: frontendMessage("workflow.node.meta.start"), value: formatTime(step.startedAt), mono: true });

  return (
    <dl className="divide-y divide-ink-200/60 border-y border-ink-200/70">
      {chips.map((chip, index) => (
        <div key={index} className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 py-1.5 text-[11.5px]">
          <dt className="text-ink-500">{chip.label}</dt>
          <dd
            className={cn(
              "min-w-0 break-words text-ink-800",
              chip.mono && "font-mono text-[11px]",
              toneTextClass(chip.tone),
            )}
          >
            {chip.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function toneTextClass(tone: "default" | "warn" | "ok" | "live" | undefined): string {
  if (tone === "warn") return "text-brick-600";
  if (tone === "live") return "text-umber-600";
  return "";
}

function Section({
  label,
  copyValue,
  children,
}: {
  label: string;
  copyValue?: unknown;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <MetaLabel as="h3">{label}</MetaLabel>
        {copyValue !== undefined ? <CopyButton value={copyValue} /> : null}
      </div>
      {children}
    </section>
  );
}

function CopyButton({ value }: { value: unknown }): JSX.Element {
  const { copied, copyText } = useClipboardCopy();
  const readText = useCallback((): string => {
    if (typeof value === "string") return value;
    const serialized = JSON.stringify(value, null, 2);
    return serialized ?? String(value);
  }, [value]);

  const onCopy = async (): Promise<void> => {
    await copyText(readText());
  };
  return (
    <Tooltip content={frontendMessage("workflow.node.copyRawData")} side="right">
      <button
        type="button"
        onClick={onCopy}
        className="grid h-5 w-5 place-items-center rounded text-ink-400 transition hover:bg-ink-900/[0.05] hover:text-ink-800"
        aria-label="copy"
      >
        <MotionIconSwap stateKey={copied ? "copied" : "copy"}>
          {copied ? <Check className="h-3 w-3 text-moss-500" /> : <Copy className="h-3 w-3" />}
        </MotionIconSwap>
      </button>
    </Tooltip>
  );
}

function DataCard({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="-mx-1">{children}</div>;
}
