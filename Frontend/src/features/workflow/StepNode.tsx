import { memo } from "react";
import { Handle, type Node, type NodeProps } from "@xyflow/react";
import { AnimatePresence, motion } from "framer-motion";
import type { TimelineStep, TimelineStepKind } from "../../store/sessionStore";
import { cn, formatDurationMs } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { motionTimings, useMotionLevel, type MotionLevel } from "../../shared/motion";
import { AppIcon, type AppIconName, Spinner } from "../../shared/ui";
import { readWorkflowHandlePositions, type StepNodeData, type WorkflowLayoutDirection } from "./layout";
import { readStepStatusLabel } from "./stepPresentation";
import { readWorkflowStepDurationMs } from "./workflowPresentationProjection";
import { projectToolStagePresentation } from "./toolStagePresentation";
import { ToolActionIcon } from "./ToolActionIcon";

const KindIcon: Record<TimelineStepKind, AppIconName> = {
  understand: "message",
  prompt: "file-code",
  model: "brain",
  decision: "code",
  delegation: "git-branch",
  tool: "globe",
  retry: "activity",
  answer: "message",
  error: "cancel",
};

type WorkflowStepNode = Node<StepNodeData>;

function StepNodeBase({ data, selected }: NodeProps<WorkflowStepNode>): JSX.Element {
  const { level, reduceMotion, disableMotion } = useMotionLevel();
  const handlePositions = readWorkflowHandlePositions(data.layout.direction);

  if (data.kind === "scope") {
    return <ScopeNode group={data.group} layoutDirection={data.layout.direction} selected={selected} />;
  }

  const step = data.step;
  const icon = KindIcon[step.kind];
  const title = step.kind === "tool" && step.toolName ? step.toolName : step.title;
  const toolPresentation = step.kind === "tool" ? projectToolStagePresentation({ steps: [step] }) : undefined;
  const effectiveLevel = disableMotion ? "none" : reduceMotion ? "reduced" : level;
  const statusClass =
    step.status === "failed" || step.kind === "error"
      ? "border-brick-500"
      : step.status === "running"
        ? "border-umber-500"
        : step.status === "cancelling"
          ? "border-accent-content"
          : "border-line-subtle";
  const iconClass =
    step.status === "failed" || step.kind === "error"
      ? "text-brick-600"
      : step.status === "running"
        ? "text-umber-600"
        : step.status === "cancelling"
          ? "text-accent-content"
          : "text-content-secondary";
  const isParallelBatch =
    step.kind === "tool" && step.toolBatch?.executionMode === "parallel" && (step.toolBatch.size ?? 0) > 1;

  return (
    <div
      className={cn(
        "group relative w-[240px] cursor-pointer select-none rounded-lg border bg-surface-raised px-3 py-2.5 shadow-panel transition-[border-color,background-color,box-shadow] duration-150",
        "hover:border-line-strong hover:bg-surface-subtle hover:shadow-[var(--shadow-soft)]",
        isParallelBatch && "border-accent-border bg-accent-surface/35",
        statusClass,
        selected ? "outline outline-2 outline-offset-2 outline-accent-focus" : "",
      )}
      data-workflow-layout-direction={data.layout.direction}
    >
      <Handle
        type="target"
        position={handlePositions.target}
        className="!h-1.5 !w-1.5 !border-surface-raised !bg-content-muted"
      />

      <div className={cn("flex items-start gap-2.5", isParallelBatch && "border-l-2 border-accent-content/60 pl-2")}>
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center">
          {toolPresentation ? (
            <ToolActionIcon icon={toolPresentation.icon} status={step.status} />
          ) : (
            <StatusIcon
              status={step.status}
              kind={step.kind}
              icon={icon}
              className={iconClass}
              motionLevel={effectiveLevel}
            />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-content-primary">{title}</div>
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
        position={handlePositions.source}
        className="!h-1.5 !w-1.5 !border-surface-raised !bg-content-muted"
      />
    </div>
  );
}

export const StepNode = memo(StepNodeBase);

function ScopeNode({
  group,
  layoutDirection,
  selected,
}: {
  group: Extract<StepNodeData, { kind: "scope" }>["group"];
  layoutDirection: WorkflowLayoutDirection;
  selected: boolean;
}): JSX.Element {
  const handlePositions = readWorkflowHandlePositions(layoutDirection);
  const statusClass =
    group.status === "failed"
      ? "border-brick-500"
      : group.status === "running"
        ? "border-umber-500"
        : group.status === "cancelling"
          ? "border-accent-content"
          : "border-line-subtle";

  return (
    <div
      className={cn(
        "group relative w-[240px] cursor-default select-none rounded-lg border bg-surface-subtle px-3 py-2.5 shadow-panel transition-colors duration-150",
        statusClass,
        selected ? "outline outline-2 outline-offset-2 outline-accent-focus" : "",
      )}
      data-workflow-layout-direction={layoutDirection}
    >
      <Handle
        type="target"
        position={handlePositions.target}
        className="!h-1.5 !w-1.5 !border-surface-raised !bg-content-muted"
      />
      <div className="flex items-start gap-2.5">
        <AppIcon icon="git-branch" size={16} className="mt-0.5 text-content-secondary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-content-primary">{group.label}</div>
          {group.description ? (
            <div className="mt-1 truncate text-[11.5px] text-content-secondary">{group.description}</div>
          ) : null}
          {group.status !== "done" ? (
            <div
              className={cn(
                "mt-1 text-[10.5px]",
                group.status === "failed"
                  ? "text-brick-600"
                  : group.status === "cancelling"
                    ? "text-accent-content"
                    : "text-umber-600",
              )}
            >
              {readStepStatusLabel(group.status)}
            </div>
          ) : null}
        </div>
      </div>
      <Handle
        type="source"
        position={handlePositions.source}
        className="!h-1.5 !w-1.5 !border-surface-raised !bg-content-muted"
      />
    </div>
  );
}

function StatusIcon({
  status,
  kind,
  icon,
  className,
  motionLevel,
}: {
  status: TimelineStep["status"];
  kind: TimelineStep["kind"];
  icon: AppIconName;
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
          <Spinner size="xs" className={className} />
        ) : status === "cancelling" ? (
          <Spinner size="xs" className={className} />
        ) : status === "failed" || kind === "error" ? (
          <AppIcon icon="cancel" size={12} className={className} aria-hidden="true" />
        ) : (
          <AppIcon icon={icon} size={12} className={className} aria-hidden="true" />
        )}
      </motion.span>
    </AnimatePresence>
  );
}

function StatusFooter({ step, motionLevel }: { step: TimelineStep; motionLevel: MotionLevel }): JSX.Element | null {
  const durationMs = readWorkflowStepDurationMs(step);
  const label =
    durationMs !== undefined
      ? formatDurationMs(durationMs)
      : step.status === "running"
        ? frontendMessage("workflow.node.runningLive")
        : step.status === "cancelling"
          ? frontendMessage("workflow.run.status.cancelling")
          : null;
  if (!label) return null;
  const transition = motionLevel === "none" ? { duration: 0 } : motionTimings.fast;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={isActiveTimelineStatus(step.status) ? step.status : (step.endedAt ?? "ended")}
        initial={{ opacity: motionLevel === "none" ? 1 : 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: motionLevel === "none" ? 1 : 0 }}
        transition={transition}
        className={cn(
          "mt-1.5 text-right text-[10px] tabular-nums",
          step.status === "running"
            ? "text-umber-600"
            : step.status === "cancelling"
              ? "text-accent-content"
              : "text-content-muted",
        )}
      >
        {label}
      </motion.div>
    </AnimatePresence>
  );
}

function isActiveTimelineStatus(status: TimelineStep["status"]): boolean {
  return status === "running" || status === "cancelling";
}
