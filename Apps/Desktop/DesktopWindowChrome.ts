import type { BrowserWindow } from "electron";

/** Frameless windows on Windows/Linux, native traffic lights on macOS. */
export function readWindowFrameOptions(): { frame: false } | { titleBarStyle: "hiddenInset" } {
  return process.platform === "darwin" ? { titleBarStyle: "hiddenInset" } : { frame: false };
}

export function readWindowState(window: BrowserWindow): { isMaximized: boolean } {
  return { isMaximized: window.isMaximized() };
}
