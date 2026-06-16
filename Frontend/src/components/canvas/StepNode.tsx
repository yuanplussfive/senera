import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Check,
  Globe,
  Loader2,
  AlertTriangle,
  RotateCcw,
  Braces,
  MessageSquareText,
  Cpu,
  FileCode2,
  X,
} from "lucide-react";
import type { TimelineStep, TimelineStepKind } from "../../store/sessionStore";
import { cn, formatDuration, hasMeasuredDuration } from "../../lib/util";

const KindIcon: Record<TimelineStepKind, React.ComponentType<{ className?: string }>> = {
  understand: MessageSquareText,
  prompt: FileCode2,
  model: Cpu,
  decision: Braces,
  tool: Globe,
  retry: RotateCcw,
  answer: Check,
  error: AlertTriangle,
};

function StepNodeBase({ data, selected }: NodeProps): JSX.Element {
  const step = (data as { step: TimelineStep }).step;
  const Icon = KindIcon[step.kind];

  const accent = colorOf(step);

  return (
    <div
      className={cn(
        "group relative w-[240px] cursor-pointer rounded-xl border bg-paper-50 px-3 py-2.5 transition-all",
        "shadow-[0_1px_2px_rgba(28,26,23,0.04)] hover:shadow-[0_4px_12px_rgba(28,26,23,0.10)]",
        accent.border,
        selected ? "ring-2 ring-terra-400 ring-offset-2 ring-offset-paper-100" : "",
      )}
    >
      {/* 顶部 handle 接前驱 */}
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2 !w-2 !border-paper-50 !bg-ink-300"
      />

      {/* 头：图标 + 标题 + 状态 */}
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-lg",
            accent.iconBg,
          )}
        >
          {step.status === "running" ? (
            <Loader2 className={cn("h-3 w-3 animate-spin", accent.iconFg)} />
          ) : step.status === "failed" || step.kind === "error" ? (
            <X className={cn("h-3 w-3", accent.iconFg)} />
          ) : (
            <Icon className={cn("h-3 w-3", accent.iconFg)} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12.5px] font-medium text-ink-900">
              {step.title}
            </span>
            <StatusDot status={step.status} />
          </div>
          {step.description ? (
            <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-ink-500">
              {step.description}
            </p>
          ) : null}
        </div>
      </div>

      {/* 工具特化：callId */}
      {step.kind === "tool" && step.callId ? (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="font-mono text-[9.5px] uppercase tracking-wider text-ink-400">
            call
          </span>
          <span className="rounded bg-paper-200/70 px-1.5 py-0.5 font-mono text-[10px] text-ink-700">
            {step.callId.slice(0, 12)}
          </span>
        </div>
      ) : null}

      {/* 错误一笔带过——细节看抽屉 */}
      {step.toolErrorMessage || step.errorMessage ? (
        <div className="mt-1.5 line-clamp-2 rounded-md border border-brick-100 bg-brick-50/60 px-2 py-1 text-[10.5px] text-brick-600">
          {step.toolErrorMessage || step.errorMessage}
        </div>
      ) : null}

      {/* 底部：时长 */}
      {hasMeasuredDuration(step.startedAt, step.endedAt) ? (
        <div className="mt-1.5 text-right font-mono text-[10px] text-ink-400">
          {formatDuration(step.startedAt, step.endedAt)}
        </div>
      ) : step.status === "running" ? (
        <div className="mt-1.5 text-right font-mono text-[10px] text-terra-500">
          live · 进行中
        </div>
      ) : null}

      {/* 底部 handle 接后继 */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !border-paper-50 !bg-ink-300"
      />
    </div>
  );
}

export const StepNode = memo(StepNodeBase);

function StatusDot({ status }: { status: TimelineStep["status"] }): JSX.Element | null {
  if (status === "running") {
    return (
      <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-terra-500 shadow-[0_0_0_3px_rgba(179,68,31,0.18)]" />
    );
  }
  if (status === "done") {
    return <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-moss-500" />;
  }
  if (status === "failed") {
    return <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-brick-500" />;
  }
  return <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-ink-300" />;
}

interface NodeAccent {
  border: string;
  iconBg: string;
  iconFg: string;
}

function colorOf(step: TimelineStep): NodeAccent {
  if (step.status === "failed" || step.kind === "error") {
    return {
      border: "border-brick-100",
      iconBg: "bg-brick-50",
      iconFg: "text-brick-500",
    };
  }
  if (step.status === "running") {
    return {
      border: "border-terra-200",
      iconBg: "bg-terra-50",
      iconFg: "text-terra-500",
    };
  }
  switch (step.kind) {
    case "understand":
    case "prompt":
      return {
        border: "border-ink-200/70",
        iconBg: "bg-paper-200",
        iconFg: "text-ink-600",
      };
    case "model":
      return {
        border: "border-ink-200/70",
        iconBg: "bg-ink-900",
        iconFg: "text-paper-50",
      };
    case "decision":
      return {
        border: "border-ink-200/70",
        iconBg: "bg-ink-100",
        iconFg: "text-ink-800",
      };
    case "tool":
      return {
        border: "border-ink-200/70",
        iconBg: "bg-terra-50",
        iconFg: "text-terra-500",
      };
    case "retry":
      return {
        border: "border-terra-100",
        iconBg: "bg-terra-50",
        iconFg: "text-terra-600",
      };
    case "answer":
      return {
        border: "border-moss-100",
        iconBg: "bg-moss-500",
        iconFg: "text-paper-50",
      };
    default:
      return {
        border: "border-ink-200/70",
        iconBg: "bg-paper-200",
        iconFg: "text-ink-600",
      };
  }
}
