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
import { motionTimings, useMotionLevel, type MotionLevel } from "../../shared/motion";
import type { StepNodeData } from "./layout";
import { readStepStatusLabel } from "./stepPresentation";

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
  const effectiveLevel = disableMotion ? "none" : reduceMotion ? "reduced" : level;
  const statusClass =
    step.status === "failed" || step.kind === "error"
      ? "border-brick-300"
      : step.status === "running"
        ? "border-umber-300"
        : "border-line-subtle";
  const iconClass =
    step.status === "failed" || step.kind === "error"
      ? "text-brick-600"
      : step.status === "running"
        ? "text-umber-600"
        : "text-content-secondary";

  return (
    <div
      className={cn(
        "group relative w-[240px] cursor-pointer select-none rounded-lg border bg-surface-raised px-3 py-2.5 shadow-panel transition-[border-color,background-color,box-shadow] duration-150",
        "hover:border-line-strong hover:bg-surface-subtle hover:shadow-[var(--shadow-soft)]",
        statusClass,
        selected ? "outline outline-2 outline-offset-2 outline-accent-focus" : "",
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !border-surface-raised !bg-content-muted"
      />

      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center">
          <StatusIcon
            status={step.status}
            kind={step.kind}
            icon={Icon}
            className={iconClass}
            motionLevel={effectiveLevel}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-content-primary">{step.title}</div>
          {step.description ? (
            <p className="mt-1 line-clamp-2 text-[11.5px] leading-[1.45] text-content-secondary">{step.description}</p>
          ) : null}
        </div>
      </div>

      {step.kind === "tool" && step.callId ? (
        <div className="mt-2 flex min-w-0 gap-1 font-mono text-[10px] text-content-muted">
          <span>call</span>
          <span className="truncate">{step.callId.slice(0, 12)}</span>
        </div>
      ) : null}

      {step.toolErrorMessage || step.errorMessage ? (
        <div className="mt-2 line-clamp-2 border-t border-brick-200/70 pt-1.5 text-[10.5px] text-brick-600">
          {step.toolErrorMessage || step.errorMessage}
        </div>
      ) : null}

      <StatusFooter step={step} motionLevel={effectiveLevel} />

      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !border-surface-raised !bg-content-muted"
      />
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
  const statusClass =
    group.status === "failed"
      ? "border-brick-300"
      : group.status === "running"
        ? "border-umber-300"
        : "border-line-subtle";

  return (
    <div
      className={cn(
        "group relative w-[240px] cursor-default select-none rounded-lg border bg-surface-subtle px-3 py-2.5 shadow-panel transition-colors duration-150",
        statusClass,
        selected ? "outline outline-2 outline-offset-2 outline-accent-focus" : "",
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !border-surface-raised !bg-content-muted"
      />
      <div className="flex items-start gap-2.5">
        <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-content-secondary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-content-primary">{group.label}</div>
          {group.description ? (
            <div className="mt-1 truncate text-[11.5px] text-content-secondary">{group.description}</div>
          ) : null}
          {group.status !== "done" ? (
            <div className={cn("mt-1 text-[10.5px]", group.status === "failed" ? "text-brick-600" : "text-umber-600")}>
              {readStepStatusLabel(group.status)}
            </div>
          ) : null}
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !border-surface-raised !bg-content-muted"
      />
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
          step.status === "running" ? "text-umber-600" : "text-content-muted",
        )}
      >
        {label}
      </motion.div>
    </AnimatePresence>
  );
}
