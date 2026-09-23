import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/util";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuLabel,
  ContextMenuTrigger,
  AppIcon,
  Spinner,
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
  onClick: () => void;
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
  onClick,
  onRename,
  onClose,
  onFocus = () => undefined,
}: SessionRowProps): JSX.Element {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const selectionButtonRef = useRef<HTMLButtonElement>(null);
  const pendingDialogActionRef = useRef<(() => void) | null>(null);
  const { reduceMotion, disableMotion } = useMotionLevel();
  const animateSelection = !reduceMotion && !disableMotion;
  const setItemRef = useCallback((node: HTMLDivElement | null) => registerItem(index, node), [index, registerItem]);
  const actions: SessionMenuAction[] = [
    {
      id: "rename",
      label: frontendMessage("session.rename"),
      icon: <AppIcon icon="pencil" className="h-3.5 w-3.5" />,
      onSelect: () => {
        pendingDialogActionRef.current = () => onRename(selectionButtonRef.current);
      },
    },
    {
      id: "delete",
      label: frontendMessage("session.deleteHistory"),
      icon: <AppIcon icon="trash" className="h-3.5 w-3.5" />,
      destructive: true,
      onSelect: () => {
        pendingDialogActionRef.current = () => onClose(selectionButtonRef.current);
      },
    },
  ];

  useEffect(() => {
    if (contextMenuOpen) return;
    const pendingAction = pendingDialogActionRef.current;
    if (!pendingAction) return;
    pendingDialogActionRef.current = null;
    pendingAction();
  }, [contextMenuOpen]);

  return (
    <ContextMenu onOpenChange={setContextMenuOpen}>
      <ContextMenuTrigger asChild>
        <div
          ref={setItemRef}
          data-session-row={sessionId}
          className={cn(
            "group relative isolate z-10 grid h-11 w-full items-center rounded-[9px] px-2.5 text-left transition-colors duration-150",
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
              className="pointer-events-none absolute inset-0 z-0 rounded-[9px] bg-[var(--theme-session-active-bg)]"
              data-active-session-indicator
            />
          ) : null}
          <button
            ref={selectionButtonRef}
            type="button"
            aria-current={active ? "true" : undefined}
            aria-label={frontendMessage("session.open", { title })}
            onClick={onClick}
            onFocus={onFocus}
            onKeyDown={(event) => {
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
            }}
            className="absolute inset-0 z-10 cursor-pointer rounded-[9px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-focus"
          />
          <div className="pointer-events-none relative z-20 min-w-0 overflow-hidden pr-1">
            <div className="flex min-w-0 items-center gap-1.5">
              {accent === "running" ? (
                <span role="status" aria-label={frontendMessage("session.statusRunning")} className="shrink-0">
                  <Spinner size="xs" className="text-umber-600" />
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
              <span
                className={cn(
                  "block min-w-0 max-w-full cursor-[inherit] select-none truncate text-[13px] leading-5 transition-colors duration-150",
                  "font-normal",
                )}
              >
                {title}
              </span>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[196px]">
        <ContextMenuLabel>{frontendMessage("session.actions")}</ContextMenuLabel>
        <ContextSessionMenuItems actions={actions} separateLast />
      </ContextMenuContent>
    </ContextMenu>
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
