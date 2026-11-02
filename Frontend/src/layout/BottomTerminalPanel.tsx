import { motion } from "framer-motion";
import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import { motionTimings, useMotionLevel } from "../shared/motion";
import { readTerminalPanelLayout } from "../shared/responsive/terminalPanel";
import { AppIcon, IconButton } from "../shared/ui";
import { useStore } from "../store/sessionStore";

export interface TerminalPanelRenderProps {
  active: boolean;
  actions: ReactNode;
}

export function BottomTerminalPanel({
  viewportHeight,
  renderPanel,
}: {
  viewportHeight: number;
  renderPanel: (props: TerminalPanelRenderProps) => ReactNode;
}): JSX.Element {
  const open = useStore((state) => state.terminalPanelOpen);
  const maximized = useStore((state) => state.terminalPanelMaximized);
  const heightRatio = useStore((state) => state.terminalPanelHeightRatio);
  const setOpen = useStore((state) => state.setTerminalPanelOpen);
  const setMaximized = useStore((state) => state.setTerminalPanelMaximized);
  const setHeightRatio = useStore((state) => state.setTerminalPanelHeightRatio);
  const { reduceMotion, disableMotion } = useMotionLevel();
  const [resizeHeight, setResizeHeight] = useState<number | null>(null);
  const resizeRef = useRef<{ pointerId: number; startY: number; startHeight: number; height: number } | null>(null);
  const layout = readTerminalPanelLayout(viewportHeight, heightRatio);
  const height = resizeHeight ?? layout.height;

  const clampHeight = (value: number): number => Math.min(layout.max, Math.max(layout.min, value));
  const startResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || maximized) return;
    event.preventDefault();
    resizeRef.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: height, height };
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizeHeight(height);
  };
  const moveResize = (event: PointerEvent<HTMLDivElement>): void => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    resize.height = clampHeight(resize.startHeight + resize.startY - event.clientY);
    setResizeHeight(resize.height);
  };
  const endResize = (event: PointerEvent<HTMLDivElement>): void => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    if (event.type !== "pointercancel") setHeightRatio(resize.height / viewportHeight);
    setResizeHeight(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const resizeByKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = 16;
    const next =
      event.key === "ArrowUp"
        ? height + step
        : event.key === "ArrowDown"
          ? height - step
          : event.key === "Home"
            ? layout.min
            : event.key === "End"
              ? layout.max
              : null;
    if (next === null) return;
    event.preventDefault();
    setHeightRatio(clampHeight(next) / viewportHeight);
  };
  const collapse = useCallback((): void => {
    setOpen(false);
    document.querySelector<HTMLElement>("[data-terminal-panel-toggle]")?.focus({ preventScroll: true });
  }, [setOpen]);
  const maximizeLabel = frontendMessage(maximized ? "terminal.panel.restore" : "terminal.panel.maximize");
  const collapseLabel = frontendMessage("terminal.panel.collapse");
  const actions = useMemo(
    () => (
      <div className="flex shrink-0 items-center gap-0.5" data-terminal-panel-actions>
        <IconButton
          label={maximizeLabel}
          tooltip={maximizeLabel}
          size="sm"
          onClick={() => setMaximized(!maximized)}
          className="h-7 w-7 text-content-muted hover:bg-surface-hover hover:text-content-primary"
        >
          <AppIcon icon={maximized ? "restore" : "maximize"} size={14} />
        </IconButton>
        <IconButton
          label={collapseLabel}
          tooltip={collapseLabel}
          size="sm"
          onClick={collapse}
          className="h-7 w-7 text-content-muted hover:bg-surface-hover hover:text-content-primary"
        >
          <AppIcon icon="close" size={14} />
        </IconButton>
      </div>
    ),
    [maximizeLabel, collapseLabel, maximized, setMaximized, collapse],
  );
  // Pointer movement changes the layout, not the terminal tree or its providers.
  const panel = useMemo(() => renderPanel({ active: open, actions }), [open, renderPanel, actions]);

  return (
    <motion.section
      initial={false}
      animate={{ height: open ? (maximized ? "calc(100% - var(--senera-titlebar-height, 0px))" : height) : 0 }}
      transition={
        disableMotion || reduceMotion || resizeHeight !== null
          ? { duration: 0 }
          : open
            ? motionTimings.panelOpen
            : motionTimings.panelClose
      }
      className="relative min-h-0 min-w-0 shrink-0 overflow-hidden"
      inert={!open}
      aria-hidden={!open}
      aria-label={frontendMessage("terminal.panel.title")}
      id="workspace-terminal-panel"
      data-terminal-dock="bottom"
      data-open={open}
      data-maximized={maximized}
    >
      {open && !maximized ? (
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="horizontal"
          aria-label={frontendMessage("terminal.panel.resize")}
          aria-valuemin={Math.round(layout.min)}
          aria-valuemax={Math.round(layout.max)}
          aria-valuenow={Math.round(height)}
          aria-controls="workspace-terminal-panel"
          className="group absolute inset-x-0 top-0 z-40 h-1.5 cursor-row-resize touch-none outline-none"
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onLostPointerCapture={endResize}
          onKeyDown={resizeByKeyboard}
          onDoubleClick={() => setMaximized(true)}
        >
          <span className="absolute inset-x-0 top-0 h-px bg-line-strong transition-colors group-hover:h-0.5 group-hover:bg-accent-border-strong group-focus-visible:h-0.5 group-focus-visible:bg-accent-border-strong" />
        </div>
      ) : null}
      <div className="h-full min-h-0" style={!open ? { height } : undefined}>
        {panel}
      </div>
      {resizeHeight !== null ? <div className="fixed inset-0 z-50 cursor-row-resize" aria-hidden="true" /> : null}
    </motion.section>
  );
}
