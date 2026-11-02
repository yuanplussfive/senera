export const MIN_WORKSPACE_MAIN_WIDTH = 320;
export const MIN_WORKFLOW_DOCK_WIDTH = 360;
export const DEFAULT_WORKFLOW_DOCK_WIDTH_RATIO = 0.45;
const WORKFLOW_DOCK_RATIO_BOUNDS = { min: 0.15, max: 0.7 };

export type WorkflowDockLayout = "inline" | "overlay";

export interface WorkflowDockWidthConstraints {
  readonly min: number;
  readonly max: number;
}

export function clampWorkflowDockWidthRatio(ratio: number): number {
  return Math.min(WORKFLOW_DOCK_RATIO_BOUNDS.max, Math.max(WORKFLOW_DOCK_RATIO_BOUNDS.min, ratio));
}

export function clampWorkflowDockWidth(width: number, constraints: WorkflowDockWidthConstraints): number {
  return Math.round(Math.min(constraints.max, Math.max(constraints.min, width)));
}

export interface WorkflowDockLayoutQuery {
  readonly viewportWidth: number;
  readonly sessionPanelWidth: number;
  readonly layout: WorkflowDockLayout;
  readonly widthRatio: number;
}

/** Every tool shares the width of the main area, excluding the session sidebar. */
export function readWorkflowDockLayoutMetrics(query: WorkflowDockLayoutQuery) {
  const availableWidth = Math.max(0, query.viewportWidth - query.sessionPanelWidth);
  const max = Math.max(
    0,
    Math.min(
      availableWidth * WORKFLOW_DOCK_RATIO_BOUNDS.max,
      query.layout === "inline" ? availableWidth - MIN_WORKSPACE_MAIN_WIDTH : availableWidth,
    ),
  );
  const constraints = { min: Math.min(MIN_WORKFLOW_DOCK_WIDTH, max), max };
  const width = clampWorkflowDockWidth(availableWidth * clampWorkflowDockWidthRatio(query.widthRatio), constraints);
  return { availableWidth, constraints, width };
}
