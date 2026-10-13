/**
 * Canonical execution-status tone.
 *
 * Every execution surface reads its color from here — the conversation feed,
 * the execution dock, canvas nodes, and batch progress bars. Keeping one map
 * means a status can never render in two different hues depending on where it
 * shows up: "running" used to be olive in the canvas and dock but terracotta in
 * the feed, and "done" was grey in one place and green in another.
 *
 * `running` takes the configured theme accent (`--accent-*`), so work in flight
 * always matches whatever accent the user picked instead of a fixed olive.
 * `cancelling` keeps the warm umber so the two live states stay distinguishable.
 */
export type ActivityStatus =
  "pending" | "running" | "cancelling" | "done" | "completed" | "failed" | "cancelled" | "neutral";

export type ActivityStatusMotion = "none" | "pulse" | "spin";

export interface ExecutionStatusTone {
  /** Glyph and label color. */
  readonly text: string;
  /** Solid fill for dots and progress segments. */
  readonly dot: string;
  /** Soft wash (background + text) for a filled marker. */
  readonly wash: string;
  /** Border color for a node or container carrying the status. */
  readonly border: string;
}

const NeutralTone: ExecutionStatusTone = {
  text: "text-content-muted",
  dot: "bg-ink-300",
  wash: "bg-ink-100 text-ink-500",
  border: "border-line-subtle",
};

const CancelledTone: ExecutionStatusTone = {
  text: "text-content-muted",
  dot: "bg-ink-400",
  wash: "bg-ink-100 text-ink-500",
  border: "border-line-subtle",
};

const RunningTone: ExecutionStatusTone = {
  text: "text-accent-content",
  dot: "bg-accent-content",
  wash: "bg-accent-surface text-accent-content",
  border: "border-accent-content",
};

const CancellingTone: ExecutionStatusTone = {
  text: "text-umber-600",
  dot: "bg-umber-500",
  wash: "bg-umber-50 text-umber-600",
  border: "border-umber-500",
};

const DoneTone: ExecutionStatusTone = {
  text: "text-moss-600",
  dot: "bg-moss-500",
  wash: "bg-moss-100 text-moss-600",
  border: "border-line-subtle",
};

const FailedTone: ExecutionStatusTone = {
  text: "text-brick-600",
  dot: "bg-brick-500",
  wash: "bg-brick-100 text-brick-600",
  border: "border-brick-500",
};

export const ExecutionStatusTones: Readonly<Record<ActivityStatus, ExecutionStatusTone>> = {
  pending: NeutralTone,
  neutral: NeutralTone,
  cancelled: CancelledTone,
  running: RunningTone,
  cancelling: CancellingTone,
  done: DoneTone,
  completed: DoneTone,
  failed: FailedTone,
};

export function executionStatusTone(status: ActivityStatus): ExecutionStatusTone {
  return ExecutionStatusTones[status];
}

/** Pending work is already active from the user's point of view: it has been
 * accepted and is waiting on an executor. Keep its live ring so the handoff
 * from queued to running does not make the icon disappear for a frame. */
export function isLiveActivityStatus(status: ActivityStatus): boolean {
  return status === "pending" || status === "running" || status === "cancelling";
}
