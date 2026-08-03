export const DEFAULT_WORKFLOW_DOCK_WIDTH = 420;
export const MIN_WORKFLOW_DOCK_WIDTH = 302;
export const MAX_WORKFLOW_DOCK_WIDTH = 640;
export const MIN_WORKSPACE_MAIN_WIDTH = 320;

const WORKSPACE_HORIZONTAL_CHROME_WIDTH = 40;

export interface WorkflowDockWidthConstraints {
  min: number;
  max: number;
}

export function readWorkflowDockWidthConstraints(
  viewportWidth: number,
  sessionPanelWidth: number,
): WorkflowDockWidthConstraints {
  const availableWidth =
    viewportWidth - WORKSPACE_HORIZONTAL_CHROME_WIDTH - sessionPanelWidth - MIN_WORKSPACE_MAIN_WIDTH;
  return {
    min: MIN_WORKFLOW_DOCK_WIDTH,
    max: Math.max(MIN_WORKFLOW_DOCK_WIDTH, Math.min(MAX_WORKFLOW_DOCK_WIDTH, availableWidth)),
  };
}

export function clampWorkflowDockWidth(
  width: number,
  constraints: WorkflowDockWidthConstraints = {
    min: MIN_WORKFLOW_DOCK_WIDTH,
    max: MAX_WORKFLOW_DOCK_WIDTH,
  },
): number {
  const finiteWidth = Number.isFinite(width) ? width : DEFAULT_WORKFLOW_DOCK_WIDTH;
  return Math.round(Math.min(constraints.max, Math.max(constraints.min, finiteWidth)));
}
