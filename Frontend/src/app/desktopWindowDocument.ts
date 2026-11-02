import { readDesktopBridge } from "./desktopBridge";

export type DesktopWindowSurface = "main" | "settings";

/**
 * Publish desktop-frame flags on the document root. Must run before the first
 * application render: CSS gives the loading surfaces their titlebar offset
 * from these attributes, so applying them later shifts the skeleton downward.
 */
export function applyDesktopWindowDocumentState(surface: DesktopWindowSurface): void {
  const bridge = readDesktopBridge();
  if (!bridge?.isDesktop) return;
  const root = document.documentElement;
  root.dataset.seneraDesktopWindow = "true";
  root.dataset.seneraDesktopSurface = surface;
  root.dataset.seneraWindowControls = bridge.windowControls === "custom" ? "custom" : "native";
}

export function clearDesktopWindowDocumentState(): void {
  const root = document.documentElement;
  delete root.dataset.seneraDesktopWindow;
  delete root.dataset.seneraDesktopSurface;
  delete root.dataset.seneraWindowControls;
}
