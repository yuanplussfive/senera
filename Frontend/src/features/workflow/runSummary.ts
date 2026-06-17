import type { RunRecord } from "../../store/sessionStore";
import { formatDuration, formatTime } from "../../lib/util";

export interface RunSummary {
  total: number;
  completed: number;
  failed: number;
  running: number;
  tools: number;
  duration: string;
  startedAt: string;
}

export function summarizeRun(run: RunRecord): RunSummary {
  return {
    total: run.steps.length,
    completed: run.steps.filter((step) => step.status === "done").length,
    failed: run.steps.filter((step) => step.status === "failed").length,
    running: run.steps.filter((step) => step.status === "running").length,
    tools: run.steps.filter((step) => step.kind === "tool" && !!step.toolName).length,
    duration: formatDuration(run.startedAt, run.endedAt),
    startedAt: formatTime(run.startedAt),
  };
}
