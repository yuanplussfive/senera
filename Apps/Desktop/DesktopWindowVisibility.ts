export interface DesktopVisibilityWindow {
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  isVisible: () => boolean;
  hide: () => void;
  restore: () => void;
  show: () => void;
  showInactive: () => void;
  focus: () => void;
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
