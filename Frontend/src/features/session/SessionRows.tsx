import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../../lib/util";
import { useResponsiveMode } from "../../shared/responsive";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuLabel,
  ContextMenuTrigger,
  ActivityStatusIcon,
  AppIcon,
  StateView,
} from "../../shared/ui";
import { motionTimings, useMotionLevel } from "../../shared/motion";
import { ContextSessionMenuItems } from "./SessionMenuActions";
import type { SessionMenuAction } from "./types";

interface SessionRowProps {
  index?: number;
  registerItem?: (index: number, node: HTMLDivElement | null) => void;
  fluidHoverEnabled?: boolean;
  active: boolean;
  sessionId: string;
  title: string;
  accent: "idle" | "running" | "failed";
  selectionMode?: boolean;
  selected?: boolean;
  /** Total selected rows; a multi-row selection acts as a set in the context menu. */
  selectionCount?: number;
  onClick: () => void;
  onToggleSelected?: (shift?: boolean) => void;
  onEnterSelectionMode?: () => void;
  onClearSelection?: () => void;
  onDeleteSelected?: () => void;
  onRename: (returnFocus: HTMLElement | null) => void;
  onClose: (returnFocus: HTMLElement | null) => void;
  onFocus?: () => void;
}

export function SessionRow({
  index = 0,
  registerItem = () => undefined,
  fluidHoverEnabled = false,
  active,
  sessionId,
  title,
  accent,
  selectionMode = false,
  selected = false,
  selectionCount = 0,
  onClick,
  onToggleSelected = () => undefined,
  onEnterSelectionMode = () => undefined,
  onClearSelection = () => undefined,
  onDeleteSelected = () => undefined,
  onRename,
  onClose,
  onFocus = () => undefined,
}: SessionRowProps): JSX.Element {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const selectionFocusRef = useRef<HTMLElement | null>(null);
  const pendingDialogActionRef = useRef<(() => void) | null>(null);
  const { reduceMotion, disableMotion } = useMotionLevel();
  const { isCoarsePointer } = useResponsiveMode();
  const animateSelection = !reduceMotion && !disableMotion;
  const setItemRef = useCallback((node: HTMLDivElement | null) => registerItem(index, node), [index, registerItem]);
  const actions: SessionMenuAction[] = [];
  if (selected && selectionCount > 1) {
    // Right-clicking inside the selection acts on the whole set, like a file list.
    actions.push({
      id: "delete-selected",
      label: frontendMessage("session.deleteSelectedMenu", { count: selectionCount }),
      icon: <AppIcon icon="trash" className="h-3.5 w-3.5" />,
      destructive: true,
      onSelect: () => {
        pendingDialogActionRef.current = () => onDeleteSelected();
      },
    });
    actions.push({
      id: "clear-selection",
      label: frontendMessage("session.cancelSelection"),
      icon: <AppIcon icon="close" className="h-3.5 w-3.5" />,
      onSelect: () => onClearSelection(),
    });
  } else {
    if (selectionMode && !selected) {
      actions.push({
        id: "select",
        label: frontendMessage("session.addToSelection"),
        icon: <AppIcon icon="checkmark" className="h-3.5 w-3.5" />,
        onSelect: () => onToggleSelected(false),
      });
    }
    actions.push({
      id: "rename",
      label: frontendMessage("session.rename"),
      icon: <AppIcon icon="pencil" className="h-3.5 w-3.5" />,
      onSelect: () => {
        pendingDialogActionRef.current = () => onRename(selectionFocusRef.current);
      },
    });
    if (!selectionMode) {
      actions.push({
        id: "enter-selection-mode",
        label: frontendMessage("session.enterSelectionMode"),
        icon: <AppIcon icon="list-checks" className="h-3.5 w-3.5" />,
        onSelect: () => onEnterSelectionMode(),
      });
    }
    actions.push({
      id: "delete",
      label: frontendMessage("session.deleteHistory"),
      icon: <AppIcon icon="trash" className="h-3.5 w-3.5" />,
      destructive: true,
      onSelect: () => {
        pendingDialogActionRef.current = () => onClose(selectionFocusRef.current);
      },
    });
  }

  useEffect(() => {
    if (contextMenuOpen) return;
    const pendingAction = pendingDialogActionRef.current;
    if (!pendingAction) return;
    pendingDialogActionRef.current = null;
    pendingAction();
  }, [contextMenuOpen]);

  const handleContextMenuShortcut = (event: KeyboardEvent<HTMLElement>): void => {
    if (!(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: rect.left + Math.min(rect.width / 2, 120),
        clientY: rect.top + Math.min(rect.height / 2, 24),
      }),
    );
  };

  return (
    <ContextMenu onOpenChange={setContextMenuOpen}>
      <ContextMenuTrigger asChild>
        <div
          ref={setItemRef}
          data-session-row={sessionId}
          className={cn(
            "group relative isolate z-10 grid w-full items-center rounded-[10px] px-3 text-left transition-colors duration-150",
            isCoarsePointer ? "h-11" : "h-10",
            "data-[state=open]:bg-surface-hover",
            active
              ? "text-content-primary"
              : cn(
                  "text-content-secondary hover:text-content-primary",
                  fluidHoverEnabled ? "hover:bg-transparent" : "hover:bg-surface-hover",
                ),
          )}
        >
          {active ? (
            <motion.span
              layoutId={animateSelection ? "active-session-surface" : undefined}
              transition={animateSelection ? { layout: motionTimings.selection } : { duration: 0 }}
              className="pointer-events-none absolute inset-0 z-0 rounded-[10px] bg-[var(--theme-session-active-bg)]"
              data-active-session-indicator
            />
          ) : selected ? (
            // Selection reuses the active surface instead of an accent wash: the
            // sidebar keeps one neutral material and the check mark carries state.
            <span
              className="pointer-events-none absolute inset-0 z-0 rounded-[10px] bg-[var(--theme-session-active-bg)] transition-colors duration-150"
              data-selected-session-indicator
            />
          ) : null}
          {selectionMode ? (
            <label className="absolute inset-0 z-20 flex min-w-0 cursor-pointer items-center gap-2 overflow-hidden px-3">
              <span className="relative grid h-3.5 w-3.5 shrink-0 place-items-center">
                <input
                  type="checkbox"
                  ref={(node) => {
                    selectionFocusRef.current = node;
                  }}
                  checked={selected}
                  aria-label={frontendMessage("session.selectConversation", { title })}
                  onClick={(event) => {
                    // The click carries the modifier; change does not. Toggling here
                    // keeps shift and keyboard (Space also fires click) on one path.
                    onToggleSelected(event.shiftKey);
                  }}
                  onChange={() => undefined}
                  onFocus={onFocus}
                  onKeyDown={handleContextMenuShortcut}
                  className="peer h-3.5 w-3.5 shrink-0 cursor-pointer appearance-none rounded-[4px] border border-line-strong bg-transparent transition-[background-color,border-color] duration-150 checked:border-content-secondary checked:bg-content-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
                />
                <AppIcon
                  icon="checkmark"
                  className="pointer-events-none absolute h-2.5 w-2.5 text-content-inverse opacity-0 transition-opacity duration-150 peer-checked:opacity-100"
                  strokeWidth={3}
                />
              </span>
              <SessionTitleContent accent={accent} title={title} />
            </label>
          ) : (
            <>
              <button
                ref={(node) => {
                  selectionFocusRef.current = node;
                }}
                type="button"
                aria-current={active ? "true" : undefined}
                aria-label={frontendMessage("session.open", { title })}
                onClick={onClick}
                onFocus={onFocus}
                onKeyDown={handleContextMenuShortcut}
                className="absolute inset-0 z-10 cursor-pointer rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-focus"
              />
              <div className="pointer-events-none relative z-20 min-w-0 overflow-hidden pr-1">
                <SessionTitleContent accent={accent} title={title} />
              </div>
            </>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[196px]">
        <ContextMenuLabel>{frontendMessage("session.actions")}</ContextMenuLabel>
        <ContextSessionMenuItems actions={actions} separateLast />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function SessionTitleContent({ accent, title }: { accent: SessionRowProps["accent"]; title: string }): JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="grid h-4 w-4 shrink-0 place-items-center">
        {accent === "running" ? (
          <span role="status" aria-label={frontendMessage("session.statusRunning")} className="shrink-0">
            <ActivityStatusIcon status="running" size={13} />
          </span>
        ) : accent === "failed" ? (
          <AppIcon
            icon="alert"
            className="h-3 w-3 shrink-0 text-brick-600"
            role="img"
            aria-label={frontendMessage("session.statusFailed")}
            aria-hidden={undefined}
          />
        ) : null}
      </span>
      <span className="block min-w-0 max-w-full select-none truncate text-[13px] font-normal leading-5 transition-colors duration-150">
        {title}
      </span>
    </div>
  );
}

export function EmptyState({ onNewSession }: { onNewSession: () => void }): JSX.Element {
  return (
    <StateView
      status="empty"
      className="min-h-[200px] px-4"
      description={frontendMessage("session.emptyTitle")}
      action={
        <button
          type="button"
          onClick={onNewSession}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-content-secondary transition hover:bg-surface-hover hover:text-content-primary"
        >
          <AppIcon icon="pencil" className="h-3 w-3" />
          {frontendMessage("session.emptyAction")}
        </button>
      }
    />
  );
}
