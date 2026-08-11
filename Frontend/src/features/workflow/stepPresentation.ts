import type { RunRecord, TimelineStep, TimelineStepKind, TimelineStepStatus } from "../../store/sessionStore";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";

export type StepStatusTone = "default" | "warn" | "ok" | "live" | "cancelling";

export interface StepAccent {
  border: string;
  iconBg: string;
  iconFg: string;
}

export const stepKindLabels = {
  understand: "workflow.step.kind.understand",
  prompt: "workflow.step.kind.prompt",
  model: "workflow.step.kind.model",
  decision: "workflow.step.kind.decision",
  delegation: "workflow.step.kind.delegation",
  tool: "workflow.step.kind.tool",
  retry: "workflow.step.kind.retry",
  answer: "workflow.step.kind.answer",
  error: "workflow.step.kind.error",
} as const satisfies Record<TimelineStepKind, Parameters<typeof frontendMessage>[0]>;

export function readStepKindLabel(kind: TimelineStepKind): string {
  return frontendMessage(stepKindLabels[kind]);
}

export function readStepStatusLabel(status: TimelineStepStatus): string {
  return frontendMessage(
    (
      {
        pending: "workflow.step.status.pending",
        running: "workflow.step.status.running",
        cancelling: "workflow.run.status.cancelling",
        done: "workflow.step.status.done",
        failed: "workflow.step.status.failed",
      } satisfies Record<TimelineStepStatus, Parameters<typeof frontendMessage>[0]>
    )[status],
  );
}

export function readStepStatusTone(status: TimelineStepStatus): StepStatusTone {
  return (
    {
      pending: "default",
      running: "live",
      cancelling: "cancelling",
      done: "ok",
      failed: "warn",
    } satisfies Record<TimelineStepStatus, StepStatusTone>
  )[status];
}

export function readRunStatusLabel(status: RunRecord["status"]): string {
  return frontendMessage(
    (
      {
        running: "workflow.run.status.running",
        cancelling: "workflow.run.status.cancelling",
        completed: "workflow.run.status.completed",
        failed: "workflow.run.status.failed",
        cancelled: "workflow.run.status.cancelled",
      } satisfies Record<RunRecord["status"], Parameters<typeof frontendMessage>[0]>
    )[status],
  );
}

export function readStepAccent(step: Pick<TimelineStep, "kind" | "status">): StepAccent {
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

  if (step.status === "cancelling") {
    return {
      border: "border-accent-border",
      iconBg: "bg-accent-surface",
      iconFg: "text-accent-content",
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
    case "delegation":
      return {
        border: "border-accent-border",
        iconBg: "bg-accent-surface",
        iconFg: "text-accent-content",
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
        iconBg: "bg-accent-surface",
        iconFg: "text-accent-content",
      };
    case "retry":
      return {
        border: "border-accent-border",
        iconBg: "bg-accent-surface",
        iconFg: "text-accent-content",
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
