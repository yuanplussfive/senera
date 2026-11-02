import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../../lib/util";
import {
  ContextMenu,
  ContextMenuContent,
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
  const animateSelection = !reduceMotion && !disableMotion;
  const setItemRef = useCallback((node: HTMLDivElement | null) => registerItem(index, node), [index, registerItem]);
  const actions: SessionMenuAction[] = [];
  if (selected && selectionCount > 1) {
    // Right-clicking inside the selection acts on the whole set (Linear semantics).
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
  } else if (!selectionMode) {
    actions.push({
      id: "rename",
      label: frontendMessage("session.rename"),
      icon: <AppIcon icon="pencil" className="h-3.5 w-3.5" />,
      onSelect: () => {
        pendingDialogActionRef.current = () => onRename(selectionFocusRef.current);
      },
    });
    actions.push({
      id: "enter-selection-mode",
      label: frontendMessage("session.enterSelectionMode"),
      icon: <AppIcon icon="list-checks" className="h-3.5 w-3.5" />,
      onSelect: () => onEnterSelectionMode(),
    });
    actions.push({
      id: "delete",
      label: frontendMessage("session.delete"),
      icon: <AppIcon icon="trash" className="h-3.5 w-3.5" />,
      destructive: true,
      onSelect: () => {
        pendingDialogActionRef.current = () => onClose(selectionFocusRef.current);
      },
    });
  } else {
    if (!selected) {
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
    actions.push({
      id: "delete",
      label: frontendMessage("session.delete"),
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

  const isChoosable = selectionMode && !selected;

  return (
    <ContextMenu onOpenChange={setContextMenuOpen}>
      <ContextMenuTrigger asChild>
        <div
          ref={setItemRef}
          data-session-row={sessionId}
          data-session-selected={selected || undefined}
          className={cn(
            "group relative isolate z-10 grid h-10 w-full items-center rounded-[10px] px-3 text-left transition-colors duration-150",
            "data-[state=open]:bg-surface-hover",
            selected
              ? "text-content-primary"
              : active
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
            // Selection reuses the active session surface rather than introducing
            // an accent wash: the sidebar keeps one neutral material and the check
            // mark carries the state. Active wins when a row is both.
            <span
              className="pointer-events-none absolute inset-0 z-0 rounded-[10px] bg-[var(--theme-session-active-bg)] transition-colors duration-150"
              data-selected-session-indicator
            />
          ) : null}
          <button
            ref={(node) => {
              selectionFocusRef.current = node;
            }}
            type="button"
            aria-current={active ? "true" : undefined}
            aria-label={
              selectionMode
                ? frontendMessage("session.selectConversation", { title })
                : frontendMessage("session.open", { title })
            }
            onClick={(event) => {
              if (selectionMode) onToggleSelected(event.shiftKey);
              else onClick();
            }}
            onFocus={onFocus}
            onKeyDown={handleContextMenuShortcut}
            className="absolute inset-0 z-10 cursor-pointer rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-focus"
          />
          <div className="pointer-events-none relative z-20 flex min-w-0 items-center gap-2 overflow-hidden px-3">
            {selectionMode || selected ? (
              <span className="flex shrink-0 items-center" aria-hidden="true">
                <span
                  className={cn(
                    "grid h-3.5 w-3.5 place-items-center rounded-[4px] border transition-[background-color,border-color,color,opacity] duration-150 ease-out",
                    selected
                      ? "border-content-secondary bg-content-secondary text-content-inverse"
                      : "border-line-strong bg-transparent text-transparent",
                    isChoosable && "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                  )}
                >
                  <AppIcon icon="checkmark" className="h-2.5 w-2.5" strokeWidth={3} />
                </span>
              </span>
            ) : null}
            <SessionTitleContent accent={accent} title={title} />
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[196px]">
        <ContextSessionMenuItems actions={actions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function SessionTitleContent({ accent, title }: { accent: SessionRowProps["accent"]; title: string }): JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
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
