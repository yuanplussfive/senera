import { Maximize2, Minimize2, Minus, X } from "lucide-react";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { readDesktopBridge, type SeneraDesktopBridge } from "./desktopBridge";

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
          className="fixed inset-x-0 top-0 z-10 h-[52px] border-b border-ink-200/60 bg-[var(--theme-elevated-bg)]"
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
      className="fixed right-0 top-0 z-40 flex h-[52px] items-stretch text-ink-650"
      role="group"
      aria-label="窗口控制"
      data-desktop-window-controls
    >
      <WindowControlButton label="最小化窗口" onClick={() => void bridge.minimizeWindow?.()}>
        <Minus className="h-[15px] w-[15px]" strokeWidth={1.7} />
      </WindowControlButton>
      <WindowControlButton label={isMaximized ? "还原窗口" : "最大化窗口"} onClick={toggleMaximize}>
        {isMaximized ? (
          <Minimize2 className="h-[13px] w-[13px]" strokeWidth={1.6} />
        ) : (
          <Maximize2 className="h-[13px] w-[13px]" strokeWidth={1.6} />
        )}
      </WindowControlButton>
      <WindowControlButton close label="关闭窗口" onClick={() => void bridge.closeWindow?.()}>
        <X className="h-[15px] w-[15px]" strokeWidth={1.7} />
      </WindowControlButton>
    </div>
  );
}

function WindowControlButton({
  children,
  close = false,
  label,
  onClick,
}: {
  children: ReactNode;
  close?: boolean;
  label: string;
  onClick: () => void;
}): JSX.Element {
  const className = close
    ? "grid h-full w-[46px] place-items-center bg-transparent transition-colors duration-150 hover:bg-[#c42b1c] hover:text-white focus:outline-none focus-visible:bg-[#c42b1c] focus-visible:text-white"
    : "grid h-full w-[46px] place-items-center bg-transparent transition-colors duration-150 hover:bg-ink-900/[0.055] hover:text-ink-950 focus:outline-none focus-visible:bg-ink-900/[0.075] focus-visible:text-ink-950";

  return (
    <button type="button" aria-label={label} onClick={onClick} className={className} data-window-control>
      {children}
    </button>
  );
}
