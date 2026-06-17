import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AnimatePresence, motion } from "framer-motion";
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
import {
  motionTimings,
  useMotionLevel,
  type MotionLevel,
} from "../../shared/motion";

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
  const { level, reduceMotion, disableMotion } = useMotionLevel();
  const effectiveLevel = disableMotion ? "none" : reduceMotion ? "reduced" : level;

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
          <StatusIcon
            status={step.status}
            kind={step.kind}
            icon={Icon}
            className={accent.iconFg}
            motionLevel={effectiveLevel}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12.5px] font-medium text-ink-900">
              {step.title}
            </span>
            <StatusDot status={step.status} motionLevel={effectiveLevel} />
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
        <div className="mt-1.5 line-clamp-2 rounded-md border border-brick-200/70 bg-brick-50/50 px-2 py-1 text-[10.5px] text-brick-600">
          {step.toolErrorMessage || step.errorMessage}
        </div>
      ) : null}

      {/* 底部：时长 */}
      <StatusFooter step={step} motionLevel={effectiveLevel} />

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

function StatusIcon({
  status,
  kind,
  icon: Icon,
  className,
  motionLevel,
}: {
  status: TimelineStep["status"];
  kind: TimelineStep["kind"];
  icon: React.ComponentType<{ className?: string }>;
  className: string;
  motionLevel: MotionLevel;
}): JSX.Element {
  const iconKey = status === "failed" || kind === "error" ? "failed" : status;
  const transition = motionLevel === "none" ? { duration: 0 } : motionTimings.fast;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={iconKey}
        initial={{ opacity: motionLevel === "none" ? 1 : 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: motionLevel === "none" ? 1 : 0 }}
        transition={transition}
        className="grid h-3 w-3 place-items-center"
      >
        {status === "running" ? (
          <Loader2 className={cn("h-3 w-3 animate-spin", className)} />
        ) : status === "failed" || kind === "error" ? (
          <X className={cn("h-3 w-3", className)} />
        ) : (
          <Icon className={cn("h-3 w-3", className)} />
        )}
      </motion.span>
    </AnimatePresence>
  );
}

function StatusDot({
  status,
  motionLevel,
}: {
  status: TimelineStep["status"];
  motionLevel: MotionLevel;
}): JSX.Element | null {
  const transition = motionLevel === "none" ? { duration: 0 } : motionTimings.fast;
  const color =
    status === "running"
      ? "bg-umber-500 motion-safe:animate-pulse"
      : status === "done"
        ? "bg-moss-500"
        : status === "failed"
          ? "bg-brick-500"
          : "bg-ink-300";
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={status}
        initial={{ opacity: motionLevel === "none" ? 1 : 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: motionLevel === "none" ? 1 : 0 }}
        transition={transition}
        className={cn("inline-flex h-1.5 w-1.5 shrink-0 rounded-full", color)}
      />
    </AnimatePresence>
  );
}

function StatusFooter({
  step,
  motionLevel,
}: {
  step: TimelineStep;
  motionLevel: MotionLevel;
}): JSX.Element | null {
  const label = hasMeasuredDuration(step.startedAt, step.endedAt)
    ? formatDuration(step.startedAt, step.endedAt)
    : step.status === "running"
      ? "live · 进行中"
      : null;
  if (!label) return null;
  const transition = motionLevel === "none" ? { duration: 0 } : motionTimings.fast;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={step.status === "running" ? "running" : step.endedAt ?? "ended"}
        initial={{ opacity: motionLevel === "none" ? 1 : 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: motionLevel === "none" ? 1 : 0 }}
        transition={transition}
        className={cn(
          "mt-1.5 text-right font-mono text-[10px]",
          step.status === "running" ? "text-umber-600" : "text-ink-400",
        )}
      >
        {label}
      </motion.div>
    </AnimatePresence>
  );
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
      border: "border-umber-200/60",
      iconBg: "bg-umber-50",
      iconFg: "text-umber-500",
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
