import type {
  RunRecord,
  TimelineStep,
  TimelineStepKind,
  TimelineStepStatus,
} from "../../store/sessionStore";

export type StepStatusTone = "default" | "warn" | "ok" | "live";

export interface StepAccent {
  border: string;
  iconBg: string;
  iconFg: string;
}

export const stepKindLabels = {
  understand: "理解",
  prompt: "提示",
  model: "模型",
  decision: "决策",
  tool: "工具",
  retry: "重试",
  answer: "回复",
  error: "错误",
} as const satisfies Record<TimelineStepKind, string>;

export function readStepKindLabel(kind: TimelineStepKind): string {
  return stepKindLabels[kind];
}

export function readStepStatusLabel(status: TimelineStepStatus): string {
  return (
    {
      pending: "等待",
      running: "进行中",
      done: "已完成",
      failed: "失败",
    } satisfies Record<TimelineStepStatus, string>
  )[status];
}

export function readStepStatusTone(status: TimelineStepStatus): StepStatusTone {
  return (
    {
      pending: "default",
      running: "live",
      done: "ok",
      failed: "warn",
    } satisfies Record<TimelineStepStatus, StepStatusTone>
  )[status];
}

export function readRunStatusLabel(status: RunRecord["status"]): string {
  return (
    {
      running: "进行中",
      completed: "已完成",
      failed: "失败",
      cancelled: "已取消",
    } satisfies Record<RunRecord["status"], string>
  )[status];
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
