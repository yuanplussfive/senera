import { memo, useCallback, useEffect, useState } from "react";
import { X, Copy, Check } from "lucide-react";
import type { TimelineStep } from "../../store/sessionStore";
import { friendlyDecisionKind } from "../../store/sessionStore";
import { cn, formatTime, formatDuration } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { MarkdownRenderer } from "../../shared/code/MarkdownRenderer";
import { MetaLabel, Sheet, SheetContent, Tooltip, useClipboardCopy } from "../../shared/ui";
import { readStepKindLabel, readStepStatusLabel } from "./stepPresentation";
import { DataView } from "./DataView";

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
              {contentReady ? <Body step={step} /> : <DetailSkeleton />}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-2 border-y border-ink-200/60 py-3">
        <span className="block h-3 w-24 rounded-sm bg-ink-900/[0.05]" />
        <span className="block h-3 w-40 rounded-sm bg-ink-900/[0.05]" />
      </div>
      <div className="space-y-2">
        <span className="block h-3 w-16 rounded bg-ink-900/[0.05]" />
        <span className="block h-4 w-full rounded bg-ink-900/[0.05]" />
        <span className="block h-4 w-4/5 rounded bg-ink-900/[0.05]" />
      </div>
    </div>
  );
}

function Header({ step, onClose }: { step: TimelineStep; onClose: () => void }): JSX.Element {
  return (
    <div className="flex h-14 items-center gap-2 border-b border-ink-200/60 px-5">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[15px] font-semibold text-ink-950">{step.title}</h2>
        <div className="mt-0.5 text-[10.5px] text-ink-450">{readStepKindLabel(step.kind)}</div>
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

const Body = memo(function Body({ step }: { step: TimelineStep }): JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <MetaStrip step={step} />

      {step.description ? (
        <Section label={frontendMessage("workflow.node.section.description")}>
          <MarkdownRenderer contentClassName="text-[13.5px] leading-relaxed" compact lightweightCode>
            {step.description}
          </MarkdownRenderer>
        </Section>
      ) : null}

      {step.toolErrorMessage ? (
        <Section label={frontendMessage("workflow.node.section.error")}>
          <div className="text-[13px] leading-5 text-brick-600">{step.toolErrorMessage}</div>
        </Section>
      ) : null}
      {step.errorMessage && step.errorMessage !== step.toolErrorMessage ? (
        <Section label={frontendMessage("workflow.node.section.error")}>
          <div className="text-[13px] leading-5 text-brick-600">{step.errorMessage}</div>
        </Section>
      ) : null}

      {step.toolArgs !== undefined ? (
        <Section label={frontendMessage("workflow.node.section.toolArgs")} copyValue={step.toolArgs}>
          <DataCard>
            <DataView value={step.toolArgs} />
          </DataCard>
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

      {step.toolPresentation ? <ToolResultPresentationView presentation={step.toolPresentation} /> : null}

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
  );
});

function ToolResultPresentationView({
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
      {presentation.summary ? (
        <Section label={frontendMessage("workflow.node.section.resultSummary")} copyValue={presentation.summary}>
          <MarkdownRenderer
            className="px-0 py-0"
            contentClassName="text-[13px] leading-relaxed"
            compact
            lightweightCode
          >
            {presentation.summary}
          </MarkdownRenderer>
        </Section>
      ) : null}

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
  if (step.startedAt && step.endedAt)
    chips.push({
      label: frontendMessage("workflow.node.meta.duration"),
      value: formatDuration(step.startedAt, step.endedAt),
      mono: true,
    });
  else if (step.startedAt)
    chips.push({ label: frontendMessage("workflow.node.meta.start"), value: formatTime(step.startedAt), mono: true });

  return (
    <dl className="divide-y divide-ink-200/60 border-y border-ink-200/70">
      {chips.map((chip, index) => (
        <div key={index} className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 py-1.5 text-[11.5px]">
          <dt className="text-ink-450">{chip.label}</dt>
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
        {copied ? <Check className="h-3 w-3 text-moss-500" /> : <Copy className="h-3 w-3" />}
      </button>
    </Tooltip>
  );
}

function DataCard({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="-mx-1">{children}</div>;
}
