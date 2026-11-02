import type { RunRecord } from "../../store/sessionStore";
import { formatDuration, formatTime } from "../../lib/util";
import { projectWorkflowSteps } from "./workflowPresentationProjection";

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
  const steps = projectWorkflowSteps(run);
  return {
    total: steps.length,
    completed: steps.filter((step) => step.status === "done").length,
    failed: steps.filter((step) => step.status === "failed").length,
    running: steps.filter((step) => step.status === "running").length,
    tools: steps.filter((step) => step.kind === "tool" && !!step.toolName).length,
    duration: formatDuration(run.startedAt, run.endedAt),
    startedAt: formatTime(run.startedAt),
  };
}
