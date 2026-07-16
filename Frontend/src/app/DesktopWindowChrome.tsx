import { useEffect, useMemo, type ReactNode } from "react";
import { readWindowControlsInsetWidth, type WindowControlsOverlayGeometry } from "../shared/responsive";
import { useAppearance, type AppearanceSnapshot } from "../shared/theme";
import { readDesktopBridge, type DesktopTitleBarOverlay } from "./desktopBridge";

export type DesktopWindowSurface = "main" | "settings";

const defaultWindowsControlsWidth = 138;

interface DesktopWindowControlsOverlay extends WindowControlsOverlayGeometry {
  addEventListener: (type: "geometrychange", listener: EventListener) => void;
  removeEventListener: (type: "geometrychange", listener: EventListener) => void;
}

export function DesktopWindowChrome({
  children,
  surface,
}: {
  children: ReactNode;
  surface: DesktopWindowSurface;
}): JSX.Element {
  const bridge = readDesktopBridge();
  const appearance = useAppearance();
  const overlay = useMemo(() => readDesktopTitleBarOverlay(appearance), [appearance]);

  useEffect(() => {
    if (!bridge?.isDesktop) return;
    const root = document.documentElement;
    const windowControlsOverlay = (navigator as Navigator & { windowControlsOverlay?: DesktopWindowControlsOverlay })
      .windowControlsOverlay;
    const updateControlsWidth = (): void => {
      const controlsWidth = readWindowControlsInsetWidth({
        fallbackWidth: defaultWindowsControlsWidth,
        overlay: windowControlsOverlay,
        viewportWidth: root.clientWidth,
      });
      root.style.setProperty("--senera-window-controls-width", controlsWidth + "px");
    };

    root.dataset.seneraDesktopWindow = "true";
    root.dataset.seneraDesktopSurface = surface;
    updateControlsWidth();
    window.addEventListener("resize", updateControlsWidth);
    windowControlsOverlay?.addEventListener("geometrychange", updateControlsWidth);
    return () => {
      window.removeEventListener("resize", updateControlsWidth);
      windowControlsOverlay?.removeEventListener("geometrychange", updateControlsWidth);
      root.style.removeProperty("--senera-window-controls-width");
      delete root.dataset.seneraDesktopWindow;
      delete root.dataset.seneraDesktopSurface;
    };
  }, [bridge?.isDesktop, surface]);

  useEffect(() => {
    if (!bridge?.isDesktop || !bridge.setTitleBarOverlay) return;
    void bridge.setTitleBarOverlay(overlay);
  }, [bridge, overlay]);

  return <>{children}</>;
}

export function readDesktopTitleBarOverlay(snapshot: AppearanceSnapshot): DesktopTitleBarOverlay {
  const fallbackColor = snapshot.resolvedTheme === "dark" ? "#242528" : "#ffffff";
  return {
    color: readRgbTokenAsHex(snapshot.tokens.cssVariables["--theme-elevated-bg"]) ?? fallbackColor,
    symbolColor: snapshot.resolvedTheme === "dark" ? "#f5f7fa" : "#17191c",
  };
}

function readRgbTokenAsHex(value: string | undefined): string | undefined {
  const match = value?.match(/^rgb\(\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*\)$/i);
  if (!match) return undefined;
  const channels = match.slice(1).map(Number);
  if (channels.some((channel) => channel < 0 || channel > 255)) return undefined;
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}
