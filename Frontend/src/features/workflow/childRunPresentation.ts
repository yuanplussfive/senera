import type { TimelineChildRunState } from "../../store/sessionStore";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { ExecutionStatusTones, type ActivityStatus } from "../../shared/ui/executionStatusTone";

const ChildRunStatuses = {
  queued: { label: "workflow.step.status.pending", activity: "pending" },
  running: { label: "workflow.run.status.running", activity: "running" },
  wrapping_up: { label: "workflow.childRun.status.wrappingUp", activity: "running" },
  cancelling: { label: "workflow.run.status.cancelling", activity: "cancelling" },
  awaiting_supervisor: { label: "workflow.childRun.status.awaitingSupervisor", activity: "pending" },
  completed: { label: "workflow.run.status.completed", activity: "completed" },
  partial_completed: { label: "workflow.childRun.status.partialCompleted", activity: "completed" },
  interrupted: { label: "workflow.childRun.status.interrupted", activity: "cancelled" },
  timed_out: { label: "workflow.childRun.status.timedOut", activity: "failed" },
  failed: { label: "workflow.run.status.failed", activity: "failed" },
  cancelled: { label: "workflow.run.status.cancelled", activity: "cancelled" },
} as const satisfies Record<
  TimelineChildRunState["status"],
  { label: Parameters<typeof frontendMessage>[0]; activity: ActivityStatus }
>;

export function childRunStatus(status: TimelineChildRunState["status"]) {
  const presentation = ChildRunStatuses[status];
  return { ...presentation, ...ExecutionStatusTones[presentation.activity] };
}

export function isChildRunActive(status: TimelineChildRunState["status"]): boolean {
  return (
    status === "queued" ||
    status === "running" ||
    status === "wrapping_up" ||
    status === "cancelling" ||
    status === "awaiting_supervisor"
  );
}

/** Board preview only. Full messages stay in the detail trace. */
export function childRunPreview(childRun: TimelineChildRunState, includeTask = true): string {
  for (let index = childRun.messages.length - 1; index >= 0; index--) {
    const message = childRun.messages[index];
    if (message.direction === "child_to_parent" && message.content.trim()) return message.content;
  }
  const tools = childRun.activeTools ?? [];
  if (tools.length) return `${frontendMessage("workflow.childRun.usingTool")} · ${tools.join(" · ")}`;
  return (
    (includeTask && childRun.taskLabel) ||
    frontendMessage(
      isChildRunActive(childRun.status)
        ? childRun.status === "queued"
          ? "workflow.childRun.waitingToStart"
          : "workflow.childRun.processing"
        : childRunStatus(childRun.status).label,
    )
  );
}
