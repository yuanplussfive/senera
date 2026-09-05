import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { CircleAlert, GripVertical, MoreHorizontal, PencilLine, SquarePen, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { cn } from "../../lib/util";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuLabel,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  Spinner,
  StateView,
  Tooltip,
} from "../../shared/ui";
import { motionTimings, useMotionLevel } from "../../shared/motion";
import { ContextSessionMenuItems, DropdownSessionMenuItems } from "./SessionMenuActions";
import type { SessionMenuAction } from "./types";

interface SessionRowProps {
  active: boolean;
  sessionId: string;
  title: string;
  accent: "idle" | "running" | "failed";
  onClick: () => void;
  dragging?: boolean;
  dragActive?: boolean;
  dropPosition?: "before" | "after";
  onDragStart?: (sessionId: string, event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: () => void;
  onDragOver?: (sessionId: string, event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (sessionId: string, event: DragEvent<HTMLDivElement>) => void;
  onKeyboardMove?: (sessionId: string, direction: "up" | "down" | "start" | "end") => void;
  showInlineActions: boolean;
  onRename: (returnFocus: HTMLElement | null) => void;
  onClose: (returnFocus: HTMLElement | null) => void;
}

export function SessionRow({
  active,
  sessionId,
  title,
  accent,
  onClick,
  dragging = false,
  dragActive = false,
  dropPosition,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onKeyboardMove,
  showInlineActions,
  onRename,
  onClose,
}: SessionRowProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const selectionButtonRef = useRef<HTMLButtonElement>(null);
  const pendingDialogActionRef = useRef<(() => void) | null>(null);
  const { reduceMotion, disableMotion } = useMotionLevel();
  const animateSelection = !reduceMotion && !disableMotion && !dragActive;
  const suppressClickRef = useRef(false);
  const actions: SessionMenuAction[] = [
    {
      id: "rename",
      label: frontendMessage("session.rename"),
      icon: <PencilLine className="h-3.5 w-3.5" />,
      onSelect: () => {
        pendingDialogActionRef.current = () => onRename(selectionButtonRef.current);
      },
    },
    {
      id: "delete",
      label: frontendMessage("session.deleteHistory"),
      icon: <Trash2 className="h-3.5 w-3.5" />,
      destructive: true,
      onSelect: () => {
        pendingDialogActionRef.current = () => onClose(selectionButtonRef.current);
      },
    },
  ];

  useEffect(() => {
    if (menuOpen || contextMenuOpen) return;
    const pendingAction = pendingDialogActionRef.current;
    if (!pendingAction) return;
    pendingDialogActionRef.current = null;
    pendingAction();
  }, [contextMenuOpen, menuOpen]);

  return (
    <ContextMenu onOpenChange={setContextMenuOpen}>
      <ContextMenuTrigger asChild>
        <div
          data-session-row={sessionId}
          data-session-dragging={dragging || undefined}
          data-session-drop-position={dropPosition}
          onDragOver={(event) => onDragOver?.(sessionId, event)}
          onDrop={(event) => onDrop?.(sessionId, event)}
          className={cn(
            "group relative isolate grid w-full items-center rounded-[9px] px-2.5 text-left transition-colors duration-150",
            showInlineActions ? "h-11" : "h-9",
            showInlineActions ? "grid-cols-[minmax(0,1fr)_24px_28px] gap-1" : "grid-cols-[minmax(0,1fr)_24px]",
            dragging && "opacity-55",
            "data-[state=open]:bg-surface-hover",
            active
              ? "text-content-primary"
              : "text-content-secondary hover:bg-surface-hover hover:text-content-primary",
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
          <Tooltip content={title} side="right">
            <button
              ref={selectionButtonRef}
              type="button"
              aria-current={active ? "true" : undefined}
              aria-label={frontendMessage("session.open", { title })}
              onClick={(event) => {
                if (!suppressClickRef.current) {
                  onClick();
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                suppressClickRef.current = false;
              }}
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
          </Tooltip>
          <div className="pointer-events-none relative z-20 min-w-0 overflow-hidden pr-1">
            <div className="flex min-w-0 items-center gap-1.5">
              {accent === "running" ? (
                <span role="status" aria-label={frontendMessage("session.statusRunning")} className="shrink-0">
                  <Spinner size="xs" className="text-umber-600" />
                </span>
              ) : accent === "failed" ? (
                <CircleAlert
                  className="h-3 w-3 shrink-0 text-brick-600"
                  aria-label={frontendMessage("session.statusFailed")}
                />
              ) : null}
              <span
                className={cn(
                  "block min-w-0 max-w-full cursor-[inherit] select-none truncate text-[13px] leading-5 transition-colors duration-150",
                  active ? "font-medium" : "font-normal",
                )}
              >
                {title}
              </span>
            </div>
          </div>

          {dropPosition ? (
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-x-2 z-40 h-0.5 rounded-full bg-accent-content",
                dropPosition === "before" ? "-top-px" : "-bottom-px",
              )}
            />
          ) : null}

          <Tooltip content={frontendMessage("session.reorder")} side="right">
            <button
              type="button"
              draggable
              data-session-drag-handle
              aria-label={frontendMessage("session.reorder")}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onDragStart={(event) => {
                event.stopPropagation();
                suppressClickRef.current = true;
                onDragStart?.(sessionId, event);
              }}
              onDragEnd={(event) => {
                event.stopPropagation();
                onDragEnd?.();
                globalThis.requestAnimationFrame?.(() => {
                  suppressClickRef.current = false;
                });
              }}
              onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                const direction =
                  event.key === "ArrowUp"
                    ? "up"
                    : event.key === "ArrowDown"
                      ? "down"
                      : event.key === "Home"
                        ? "start"
                        : event.key === "End"
                          ? "end"
                          : undefined;
                if (!direction) return;
                event.preventDefault();
                event.stopPropagation();
                onKeyboardMove?.(sessionId, direction);
              }}
              className={cn(
                "relative z-30 grid h-7 w-6 shrink-0 cursor-grab place-items-center rounded text-content-muted transition-[background-color,opacity,color] duration-150 hover:bg-surface-hover hover:text-content-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-focus active:cursor-grabbing",
                showInlineActions
                  ? "opacity-100"
                  : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100",
              )}
            >
              <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </Tooltip>

          {showInlineActions ? (
            <div className="relative z-20">
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    label="more"
                    size="sm"
                    tone="muted"
                    touchSafe
                    className="justify-self-end hover:bg-surface-hover"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[190px]">
                  <DropdownSessionMenuItems actions={actions} separateLast />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
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
          <SquarePen className="h-3 w-3" />
          {frontendMessage("session.emptyAction")}
        </button>
      }
    />
  );
}
