import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
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
  GitBranch,
  X,
} from "lucide-react";
import type { TimelineStep, TimelineStepKind } from "../../store/sessionStore";
import { cn, formatDuration } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { MetaLabel } from "../../shared/ui";
import { motionTimings, useMotionLevel, type MotionLevel } from "../../shared/motion";
import type { StepNodeData } from "./layout";
import { readStepAccent } from "./stepPresentation";

const KindIcon: Record<TimelineStepKind, React.ComponentType<{ className?: string }>> = {
  understand: MessageSquareText,
  prompt: FileCode2,
  model: Cpu,
  pi: GitBranch,
  decision: Braces,
  tool: Globe,
  retry: RotateCcw,
  answer: Check,
  error: AlertTriangle,
};

type WorkflowStepNode = Node<StepNodeData>;

function StepNodeBase({ data, selected }: NodeProps<WorkflowStepNode>): JSX.Element {
  const { level, reduceMotion, disableMotion } = useMotionLevel();

  if (data.kind === "scope") {
    return <ScopeNode group={data.group} selected={selected} />;
  }

  const step = data.step;
  const Icon = KindIcon[step.kind];

  const accent = readStepAccent(step);
  const effectiveLevel = disableMotion ? "none" : reduceMotion ? "reduced" : level;

  return (
    <div
      className={cn(
        "group relative w-[240px] cursor-pointer rounded-lg border bg-paper-50 px-3 py-2.5 transition-[background-color,border-color,box-shadow] duration-150 ease-out",
        "shadow-[var(--theme-node-shadow)] hover:shadow-[var(--theme-node-shadow)]",
        accent.border,
        selected ? "ring-2 ring-terra-400 ring-offset-2 ring-offset-paper-100" : "",
      )}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-paper-50 !bg-ink-300" />

      <div className="flex items-start gap-2">
        <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-lg", accent.iconBg)}>
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
            <span className="truncate text-[12.5px] font-medium text-ink-900">{step.title}</span>
            <StatusDot status={step.status} motionLevel={effectiveLevel} />
          </div>
          {step.description ? (
            <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-ink-500">{step.description}</p>
          ) : null}
        </div>
      </div>

      {step.kind === "tool" && step.callId ? (
        <div className="mt-1.5 flex items-center gap-1.5">
          <MetaLabel size="xs">call</MetaLabel>
          <span className="rounded bg-paper-200/70 px-1.5 py-0.5 font-mono text-[10px] text-ink-700">
            {step.callId.slice(0, 12)}
          </span>
        </div>
      ) : null}

      {step.toolErrorMessage || step.errorMessage ? (
        <div className="mt-1.5 line-clamp-2 rounded-md border border-brick-200/70 bg-brick-50/50 px-2 py-1 text-[10.5px] text-brick-600">
          {step.toolErrorMessage || step.errorMessage}
        </div>
      ) : null}

      <StatusFooter step={step} motionLevel={effectiveLevel} />

      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-paper-50 !bg-ink-300" />
    </div>
  );
}

export const StepNode = memo(StepNodeBase);

function ScopeNode({
  group,
  selected,
}: {
  group: Extract<StepNodeData, { kind: "scope" }>["group"];
  selected: boolean;
}): JSX.Element {
  const accent =
    group.status === "failed"
      ? "border-brick-200 bg-brick-50/70 text-brick-600"
      : group.status === "running"
        ? "border-umber-200 bg-umber-50/80 text-umber-600"
        : "border-moss-100 bg-moss-50/70 text-moss-600";

  return (
    <div
      className={cn(
        "group relative w-[240px] cursor-default rounded-lg border px-3 py-2.5 transition-[background-color,border-color,box-shadow] duration-150 ease-out",
        "shadow-[var(--shadow-bubble-user)]",
        accent,
        selected ? "ring-2 ring-terra-400 ring-offset-2 ring-offset-paper-100" : "",
      )}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-paper-50 !bg-ink-300" />
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-paper-50/75">
          <GitBranch className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-ink-900">{group.label}</div>
          {group.description ? (
            <div className="mt-0.5 truncate text-[11.5px] text-ink-500">{group.description}</div>
          ) : null}
        </div>
        <StatusDot status={group.status} motionLevel="none" />
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-paper-50 !bg-ink-300" />
    </div>
  );
}

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
      ? "bg-umber-500"
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

function StatusFooter({ step, motionLevel }: { step: TimelineStep; motionLevel: MotionLevel }): JSX.Element | null {
  const label = step.endedAt
    ? formatDuration(step.startedAt, step.endedAt)
    : step.status === "running"
      ? frontendMessage("workflow.node.runningLive")
      : null;
  if (!label) return null;
  const transition = motionLevel === "none" ? { duration: 0 } : motionTimings.fast;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={step.status === "running" ? "running" : (step.endedAt ?? "ended")}
        initial={{ opacity: motionLevel === "none" ? 1 : 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: motionLevel === "none" ? 1 : 0 }}
        transition={transition}
        className={cn(
          "mt-1.5 text-right text-[10px] tabular-nums",
          step.status === "running" ? "text-umber-600" : "text-ink-400",
        )}
      >
        {label}
      </motion.div>
    </AnimatePresence>
  );
}
