export const DEFAULT_TERMINAL_PANEL_HEIGHT_RATIO = 0.24;
const MIN_TERMINAL_PANEL_HEIGHT = 160;
const MIN_WORKSPACE_HEIGHT = 200;
const TERMINAL_PANEL_RATIO_BOUNDS = { min: 0.1, max: 0.8 };

export function clampTerminalPanelHeightRatio(ratio: number): number {
  return Math.min(TERMINAL_PANEL_RATIO_BOUNDS.max, Math.max(TERMINAL_PANEL_RATIO_BOUNDS.min, ratio));
}

export function readTerminalPanelLayout(viewportHeight: number, ratio: number) {
  const reservedHeight = Math.min(MIN_WORKSPACE_HEIGHT, Math.max(0, viewportHeight - MIN_TERMINAL_PANEL_HEIGHT));
  const max = Math.min(viewportHeight * TERMINAL_PANEL_RATIO_BOUNDS.max, viewportHeight - reservedHeight);
  const min = Math.min(MIN_TERMINAL_PANEL_HEIGHT, max);
  return { min, max, height: Math.round(Math.min(max, Math.max(min, viewportHeight * ratio))) };
}
