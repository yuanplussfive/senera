import { EventKinds, type EventKind, type EventLayer } from "../../api/generatedEventCatalog";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import type { EventJournalRecord } from "./eventJournalStore";

export type EventTrailTone = "context" | "progress" | "success" | "error" | "neutral";

const EventTitleKeys: Partial<Record<EventKind, FrontendMessageKey>> = {
  [EventKinds.RunStarted]: "observability.event.runStarted",
  [EventKinds.RunActivityChanged]: "observability.event.runActivityChanged",
  [EventKinds.RunCompleted]: "observability.event.runCompleted",
  [EventKinds.RunFailed]: "observability.event.runFailed",
  [EventKinds.RunCancelled]: "observability.event.runCancelled",
  [EventKinds.ModelStarted]: "observability.event.modelStarted",
  [EventKinds.ModelCompleted]: "observability.event.modelCompleted",
  [EventKinds.ToolCallsPlanned]: "observability.event.toolsPlanned",
  [EventKinds.ToolCallStarted]: "observability.event.toolStarted",
  [EventKinds.ToolCallOutput]: "observability.event.toolOutput",
  [EventKinds.ToolCallCompleted]: "observability.event.toolCompleted",
  [EventKinds.ToolCallFailed]: "observability.event.toolFailed",
  [EventKinds.ApprovalRequested]: "observability.event.approvalRequested",
  [EventKinds.ApprovalResolved]: "observability.event.approvalResolved",
  [EventKinds.SessionCompacted]: "observability.event.contextCompacted",
  [EventKinds.ChildRunQueued]: "observability.event.childQueued",
  [EventKinds.ChildRunStarted]: "observability.event.childStarted",
  [EventKinds.ChildRunSnapshotUpdated]: "observability.event.childProgress",
  [EventKinds.ChildRunWrappingUp]: "observability.event.childWrappingUp",
  [EventKinds.ChildRunCompleted]: "observability.event.childCompleted",
  [EventKinds.ChildRunPartialCompleted]: "observability.event.childPartialCompleted",
  [EventKinds.ChildRunFailed]: "observability.event.childFailed",
  [EventKinds.ChildRunCancelled]: "observability.event.childCancelled",
  [EventKinds.WorkflowStarted]: "observability.event.workflowStarted",
  [EventKinds.WorkflowCompleted]: "observability.event.workflowCompleted",
  [EventKinds.WorkflowFailed]: "observability.event.workflowFailed",
  [EventKinds.SandboxStatusSnapshot]: "observability.event.sandboxUpdated",
  [EventKinds.ExecutionResourceOutput]: "observability.event.resourceOutput",
};

export function readEventTitle(record: Pick<EventJournalRecord, "kind" | "summary">): string {
  const key = EventTitleKeys[record.kind as EventKind];
  if (key) return frontendMessage(key);
  return record.summary || frontendMessage("observability.event.technical", { kind: record.kind });
}

export function readEventTone(record: Pick<EventJournalRecord, "layer" | "direction">): EventTrailTone {
  if (record.layer === "error") return "error";
  if (record.layer === "terminal") return "success";
  if (record.layer === "progress") return record.direction === "outbound" ? "progress" : "context";
  if (record.layer === "snapshot") return "context";
  return "neutral";
}

export function eventToneClasses(tone: EventTrailTone): {
  dot: string;
  line: string;
  icon: string;
  selected: string;
} {
  return {
    context: {
      dot: "bg-accent-solid ring-accent-border",
      line: "bg-accent-border/70",
      icon: "bg-accent-surface text-accent-content",
      selected: "bg-accent-surface/65",
    },
    progress: {
      dot: "bg-umber-500 ring-umber-200",
      line: "bg-umber-200/80",
      icon: "bg-umber-50 text-umber-600",
      selected: "bg-umber-50/70",
    },
    success: {
      dot: "bg-moss-500 ring-moss-100",
      line: "bg-moss-100",
      icon: "bg-moss-50 text-moss-600",
      selected: "bg-moss-50/70",
    },
    error: {
      dot: "bg-brick-500 ring-brick-200",
      line: "bg-brick-200/80",
      icon: "bg-brick-50 text-brick-600",
      selected: "bg-brick-50/70",
    },
    neutral: {
      dot: "bg-ink-400 ring-ink-200",
      line: "bg-line-subtle",
      icon: "bg-surface-subtle text-content-muted",
      selected: "bg-surface-subtle/75",
    },
  }[tone];
}

export function isTerminalEventLayer(layer?: EventLayer): boolean {
  return layer === "terminal" || layer === "error";
}
