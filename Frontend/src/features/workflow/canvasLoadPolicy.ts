import type { RunRecord } from "../../store/sessionStore";
import { projectWorkflowSteps } from "./workflowPresentationProjection";

export function shouldLoadWorkflowCanvas(run: RunRecord | undefined): run is RunRecord {
  return Boolean(run && projectWorkflowSteps(run).length > 0);
}
