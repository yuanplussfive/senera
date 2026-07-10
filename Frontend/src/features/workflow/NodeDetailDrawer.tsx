import { memo, useCallback, useEffect, useState } from "react";
import { X, Copy, Check } from "lucide-react";
import type { TimelineStep } from "../../store/sessionStore";
import { friendlyDecisionKind } from "../../store/sessionStore";
import { cn, formatTime, formatDuration } from "../../lib/util";
import { MarkdownRenderer } from "../../shared/code/MarkdownRenderer";
import { MetaLabel, Sheet, SheetContent, Tooltip, useClipboardCopy } from "../../shared/ui";
import {
  readStepKindLabel,
  readStepStatusLabel,
  readStepStatusTone,
} from "./stepPresentation";
import { DataView } from "./DataView";

export interface NodeDetailDrawerProps {
  step: TimelineStep | null;
  onClose: () => void;
}

export function NodeDetailDrawer({ step, onClose }: NodeDetailDrawerProps): JSX.Element {
  const [contentReady, setContentReady] = useState(false);

  useEffect(() => {
    setContentReady(false);
    if (!step) return;
    const id = window.requestAnimationFrame(() => setContentReady(true));
    return () => window.cancelAnimationFrame(id);
  }, [step?.id]);

  return (
    <Sheet
      open={!!step}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        title={step?.title ?? "节点详情"}
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
      <div className="flex flex-wrap gap-1.5">
        <span className="h-6 w-24 rounded-full bg-ink-900/[0.05]" />
        <span className="h-6 w-32 rounded-full bg-ink-900/[0.05]" />
        <span className="h-6 w-20 rounded-full bg-ink-900/[0.05]" />
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
      <MetaLabel>
        {readStepKindLabel(step.kind)}
      </MetaLabel>
      <h2
        className="font-serif text-[17px] italic text-ink-900"
        style={{ fontWeight: 500 }}
      >
        {step.title}
      </h2>
      <button
        type="button"
        onClick={onClose}
        className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-ink-500 transition hover:bg-ink-900/[0.05] hover:text-ink-800"
        aria-label="close"
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
        <Section label="描述">
          <MarkdownRenderer contentClassName="text-[13.5px] leading-relaxed" compact lightweightCode>
            {step.description}
          </MarkdownRenderer>
        </Section>
      ) : null}

      {step.toolErrorMessage ? (
        <Section label="错误">
          <div className="rounded-md border border-brick-200/70 bg-brick-50/50 px-3 py-2 text-[13px] text-brick-600">
            {step.toolErrorMessage}
          </div>
        </Section>
      ) : null}
      {step.errorMessage && step.errorMessage !== step.toolErrorMessage ? (
        <Section label="错误">
          <div className="rounded-md border border-brick-200/70 bg-brick-50/50 px-3 py-2 text-[13px] text-brick-600">
            {step.errorMessage}
          </div>
        </Section>
      ) : null}

      {step.toolArgs !== undefined ? (
        <Section label="工具入参" copyValue={step.toolArgs}>
          <DataCard>
            <DataView value={step.toolArgs} />
          </DataCard>
        </Section>
      ) : null}

      {step.toolPreview && step.toolPreview !== step.toolPresentation?.headline ? (
        <Section label="结果预览" copyValue={step.toolPreview}>
          <MarkdownRenderer
            className="rounded-md bg-paper-100/50 px-3 py-2"
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
        <Section label="原始工具结果" copyValue={step.toolResult}>
          <DataCard>
            <DataView value={step.toolResult} />
          </DataCard>
        </Section>
      ) : null}

      {step.detailJson !== undefined ? (
        <Section label="行动详情" copyValue={step.detailJson}>
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
        <Section label="结果摘要" copyValue={presentation.summary}>
          <MarkdownRenderer
            className="rounded-md bg-paper-100/50 px-3 py-2"
            contentClassName="text-[13px] leading-relaxed"
            compact
            lightweightCode
          >
            {presentation.summary}
          </MarkdownRenderer>
        </Section>
      ) : null}

      {facts.length > 0 ? (
        <Section label="关键事实" copyValue={facts}>
          <DataCard><DataView value={facts} /></DataCard>
        </Section>
      ) : null}

      {evidence.length > 0 ? (
        <Section label="证据" copyValue={evidence}>
          <DataCard><DataView value={evidence} /></DataCard>
        </Section>
      ) : null}

      {changes.length > 0 ? (
        <Section label="变更" copyValue={changes}>
          <DataCard><DataView value={changes} /></DataCard>
        </Section>
      ) : null}

      {presentation.artifactUri ? (
        <Section label="结果归档" copyValue={presentation.artifactUri}>
          <span className="break-all font-mono text-[12px] text-ink-500">
            {presentation.artifactUri}
          </span>
        </Section>
      ) : null}
    </>
  );
}

function MetaStrip({ step }: { step: TimelineStep }): JSX.Element {
  const chips: Array<{ label: string; value: string; mono?: boolean; tone?: "default" | "warn" | "ok" | "live" }> = [];
  chips.push({ label: "状态", value: readStepStatusLabel(step.status), tone: readStepStatusTone(step.status) });
  if (step.modelName) chips.push({ label: "模型", value: step.modelName, mono: true });
  if (step.toolName) chips.push({ label: "工具", value: step.toolName });
  if (step.scope?.workflowName) chips.push({ label: "Workflow", value: step.scope.workflowName });
  if (step.scope?.agentName) chips.push({ label: "Agent", value: step.scope.agentName });
  if (step.scope?.role === "merge") chips.push({ label: "阶段", value: "结果合并" });
  if (step.decisionKind) chips.push({ label: "行动", value: friendlyDecisionKind(step.decisionKind) });
  if (step.callId)
    chips.push({ label: "callId", value: step.callId.slice(0, 14), mono: true });
  if (typeof step.retryAttempt === "number")
    chips.push({ label: "重试", value: `第 ${step.retryAttempt} 次`, tone: "warn" });
  if (typeof step.promptChars === "number") {
    chips.push({
      label: "提示词",
      value: [
        `${step.promptChars} 字`,
        `${step.promptLines ?? 0} 行`,
        typeof step.promptTokenCount === "number" ? `${step.promptTokenCount} token` : null,
      ].filter(Boolean).join(" · "),
    });
  }
  if (step.startedAt && step.endedAt)
    chips.push({ label: "时长", value: formatDuration(step.startedAt, step.endedAt), mono: true });
  else if (step.startedAt)
    chips.push({ label: "开始", value: formatTime(step.startedAt), mono: true });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c, i) => (
        <span
          key={i}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px]",
            toneClass(c.tone),
          )}
        >
          <MetaLabel size="xs">
            {c.label}
          </MetaLabel>
          <span className={cn("text-ink-800", c.mono && "font-mono text-[11px]")}>
            {c.value}
          </span>
        </span>
      ))}
    </div>
  );
}

function toneClass(tone: "default" | "warn" | "ok" | "live" | undefined): string {
  switch (tone) {
    case "warn":
      return "border-brick-200/70 bg-brick-50/50";
    case "ok":
      return "border-moss-100/60 bg-moss-50/60";
    case "live":
      return "border-umber-200/60 bg-umber-50";
    default:
      return "border-ink-200/60 bg-paper-100/60";
  }
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
        <MetaLabel as="h3">
          {label}
        </MetaLabel>
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
    <Tooltip content="复制原始数据" side="right">
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
