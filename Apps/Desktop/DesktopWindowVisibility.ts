export interface DesktopVisibilityWindow {
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  isVisible: () => boolean;
  hide: () => void;
  restore: () => void;
  show: () => void;
  showInactive: () => void;
  moveTop: () => void;
  focus: () => void;
}

/**
 * Brings an existing window back to the front of the user's attention. A surface
 * the user just asked for must be visible and active even when its window was
 * already open but hidden, minimized, or covered by another window.
 */
export function revealDesktopWindow(window: DesktopVisibilityWindow | undefined): void {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.moveTop();
  window.focus();
}

export function hideDesktopWindows(windows: readonly (DesktopVisibilityWindow | undefined)[]): void {
  for (const window of windows) {
    if (!window || window.isDestroyed()) continue;
    window.hide();
  }
}

export function showDesktopWindows(
  windows: readonly (DesktopVisibilityWindow | undefined)[],
  focusWindow?: DesktopVisibilityWindow,
): void {
  const availableWindows = windows.filter((window): window is DesktopVisibilityWindow =>
    Boolean(window && !window.isDestroyed()),
  );
  for (const window of availableWindows) {
    if (window.isMinimized()) window.restore();
    if (window === focusWindow) window.show();
    else if (!window.isVisible()) window.showInactive();
  }
  focusWindow?.focus();
}
