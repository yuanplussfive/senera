import { memo, useCallback, useEffect, useState } from "react";
import { X, Copy, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import type { TimelineStep } from "../../store/sessionStore";
import { friendlyDecisionKind } from "../../store/sessionStore";
import { cn, formatTime, formatDuration, hasMeasuredDuration } from "../../lib/util";
import { MarkdownRenderer } from "../MarkdownRenderer";
import { Tooltip } from "../ui/Tooltip";
import { DataView } from "./DataView";

interface Props {
  step: TimelineStep | null;
  onClose: () => void;
}

export function NodeDetailDrawer({ step, onClose }: Props): JSX.Element {
  const [contentReady, setContentReady] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && step) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [step, onClose]);

  useEffect(() => {
    setContentReady(false);
    if (!step) return;
    const id = window.requestAnimationFrame(() => setContentReady(true));
    return () => window.cancelAnimationFrame(id);
  }, [step?.id]);

  return (
    <AnimatePresence>
      {step ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-ink-900/10"
          />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="fixed right-0 top-0 z-50 flex h-full w-[min(560px,90vw)] flex-col border-l border-ink-200 bg-paper-50 shadow-soft will-change-transform"
          >
            <Header step={step} onClose={onClose} />
            <div className="scrollbar-thin flex-1 overflow-y-auto px-5 pb-8 pt-3">
              {contentReady ? <Body step={step} /> : <DetailSkeleton />}
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
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
      <span className="font-mono text-[10.5px] uppercase tracking-wider text-ink-400">
        {kindLabel(step.kind)}
      </span>
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

function kindLabel(kind: TimelineStep["kind"]): string {
  return ({
    understand: "理解",
    prompt: "提示",
    model: "模型",
    decision: "决策",
    tool: "工具",
    retry: "重试",
    answer: "回复",
    error: "错误",
  })[kind];
}

const Body = memo(function Body({ step }: { step: TimelineStep }): JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      {/* 元信息——一排紧凑 chips，节省竖向空间 */}
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
          <div className="rounded-md border border-brick-100 bg-brick-50/70 px-3 py-2 text-[13px] text-brick-600">
            {step.toolErrorMessage}
          </div>
        </Section>
      ) : null}
      {step.errorMessage && step.errorMessage !== step.toolErrorMessage ? (
        <Section label="错误">
          <div className="rounded-md border border-brick-100 bg-brick-50/70 px-3 py-2 text-[13px] text-brick-600">
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

      {step.toolPreview ? (
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

      {step.toolResult !== undefined ? (
        <Section label="完整结果" copyValue={step.toolResult}>
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

function MetaStrip({ step }: { step: TimelineStep }): JSX.Element {
  const chips: Array<{ label: string; value: string; mono?: boolean; tone?: "default" | "warn" | "ok" | "live" }> = [];
  chips.push({ label: "状态", value: statusLabel(step.status), tone: statusTone(step.status) });
  if (step.modelName) chips.push({ label: "模型", value: step.modelName, mono: true });
  if (step.toolName) chips.push({ label: "工具", value: step.toolName });
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
  if (hasMeasuredDuration(step.startedAt, step.endedAt))
    chips.push({ label: "时长", value: formatDuration(step.startedAt, step.endedAt), mono: true });
  else if (step.endedAt && step.status !== "running")
    chips.push({ label: "完成", value: formatTime(step.endedAt), mono: true });
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
          <span className="font-mono text-[9.5px] uppercase tracking-wider text-ink-400">
            {c.label}
          </span>
          <span className={cn("text-ink-800", c.mono && "font-mono text-[11px]")}>
            {c.value}
          </span>
        </span>
      ))}
    </div>
  );
}

function statusLabel(s: TimelineStep["status"]): string {
  return { pending: "等待", running: "进行中", done: "已完成", failed: "失败" }[s];
}

function statusTone(s: TimelineStep["status"]): "default" | "warn" | "ok" | "live" {
  if (s === "failed") return "warn";
  if (s === "done") return "ok";
  if (s === "running") return "live";
  return "default";
}

function toneClass(tone: "default" | "warn" | "ok" | "live" | undefined): string {
  switch (tone) {
    case "warn":
      return "border-brick-100 bg-brick-50/60";
    case "ok":
      return "border-moss-100/60 bg-moss-50/60";
    case "live":
      return "border-terra-200 bg-terra-50";
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
        <h3 className="font-mono text-[10.5px] uppercase tracking-wider text-ink-400">
          {label}
        </h3>
        {copyValue !== undefined ? <CopyButton value={copyValue} /> : null}
      </div>
      {children}
    </section>
  );
}

function CopyButton({ value }: { value: unknown }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const readText = useCallback((): string => {
    if (typeof value === "string") return value;
    const serialized = JSON.stringify(value, null, 2);
    return serialized ?? String(value);
  }, [value]);

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(readText());
      setCopied(true);
      toast.success("已复制");
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("复制失败");
    }
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
  // 不画外框——section 标题已经做了视觉分隔，再嵌一层卡只会让层级感更乱
  return <div className="-mx-1">{children}</div>;
}
