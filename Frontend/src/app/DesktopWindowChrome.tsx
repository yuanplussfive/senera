import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { readDesktopBridge, type SeneraDesktopBridge } from "./desktopBridge";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import { AppIcon } from "../shared/ui";

export type DesktopWindowSurface = "main" | "settings";

export function DesktopWindowChrome({
  children,
  surface,
}: {
  children: ReactNode;
  surface: DesktopWindowSurface;
}): JSX.Element {
  const bridge = readDesktopBridge();
  const customControlsBridge = bridge?.isDesktop && bridge.windowControls === "custom" ? bridge : undefined;

  useLayoutEffect(() => {
    if (!bridge?.isDesktop) return;
    const root = document.documentElement;
    root.dataset.seneraDesktopWindow = "true";
    root.dataset.seneraDesktopSurface = surface;
    root.dataset.seneraWindowControls = customControlsBridge ? "custom" : "native";
    return () => {
      delete root.dataset.seneraDesktopWindow;
      delete root.dataset.seneraDesktopSurface;
      delete root.dataset.seneraWindowControls;
    };
  }, [bridge?.isDesktop, customControlsBridge, surface]);

  return (
    <>
      {customControlsBridge ? (
        <div
          className={`fixed inset-x-0 top-0 z-10 h-[var(--senera-top-chrome-height)] ${
            surface === "main" ? "bg-transparent" : "border-b border-line-subtle bg-surface-sidebar"
          }`}
          data-desktop-window-drag-strip
          data-window-drag-region
        />
      ) : null}
      {children}
      {customControlsBridge ? <DesktopWindowControls bridge={customControlsBridge} /> : null}
    </>
  );
}

export function shouldUseCustomWindowControls(windowControls: SeneraDesktopBridge["windowControls"]): boolean {
  return windowControls === "custom";
}

function DesktopWindowControls({ bridge }: { bridge: SeneraDesktopBridge }): JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let active = true;
    const statePromise = bridge.getWindowState?.();
    if (statePromise) {
      void statePromise.then((state) => {
        if (active && state) setIsMaximized(state.isMaximized);
      });
    }
    const removeListener = bridge.onWindowStateChanged?.((state) => setIsMaximized(state.isMaximized));
    return () => {
      active = false;
      removeListener?.();
    };
  }, [bridge]);

  const toggleMaximize = (): void => {
    const statePromise = bridge.toggleMaximizeWindow?.();
    if (statePromise) {
      void statePromise.then((state) => {
        if (state) setIsMaximized(state.isMaximized);
      });
    }
  };

  return (
    <div
      className="fixed right-0 top-0 z-40 flex h-[var(--senera-top-chrome-height)] items-stretch text-content-muted"
      role="group"
      aria-label={frontendMessage("desktop.window.controls")}
      data-desktop-window-controls
    >
      <WindowControlButton
        label={frontendMessage("desktop.window.minimize")}
        onClick={() => void bridge.minimizeWindow?.()}
      >
        <AppIcon icon="minus" className="h-4 w-4" />
      </WindowControlButton>
      <WindowControlButton
        label={frontendMessage(isMaximized ? "desktop.window.restore" : "desktop.window.maximize")}
        onClick={toggleMaximize}
      >
        {isMaximized ? <AppIcon icon="restore" className="h-4 w-4" /> : <AppIcon icon="maximize" className="h-4 w-4" />}
      </WindowControlButton>
      <WindowControlButton label={frontendMessage("desktop.window.close")} onClick={() => void bridge.closeWindow?.()}>
        <AppIcon icon="close" className="h-4 w-4" />
      </WindowControlButton>
    </div>
  );
}

function WindowControlButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid h-full w-[46px] place-items-center bg-transparent transition-colors duration-150 hover:bg-ink-900/[0.055] hover:text-content-primary focus:outline-none focus-visible:bg-ink-900/[0.075] focus-visible:text-content-primary"
      data-window-control
    >
      {children}
    </button>
  );
}
