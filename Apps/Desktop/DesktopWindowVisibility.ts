export interface DesktopVisibilityWindow {
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  hide: () => void;
  restore: () => void;
  show: () => void;
  focus: () => void;
}

export function hideDesktopWindows(
  windows: readonly (DesktopVisibilityWindow | undefined)[],
): void {
  for (const window of windows) {
    if (!window || window.isDestroyed()) continue;
    window.hide();
  }
}

export function showDesktopWindows(
  windows: readonly (DesktopVisibilityWindow | undefined)[],
): void {
  const availableWindows = windows.filter(
    (window): window is DesktopVisibilityWindow => Boolean(window && !window.isDestroyed()),
  );
  for (const window of availableWindows) {
    if (window.isMinimized()) window.restore();
    window.show();
  }
  availableWindows[availableWindows.length - 1]?.focus();
}
