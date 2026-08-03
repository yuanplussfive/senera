import type { RunRecord } from "../../store/sessionStore";

export function shouldLoadWorkflowCanvas(run: RunRecord | undefined): run is RunRecord {
  return Boolean(run && run.steps.length > 0);
}
