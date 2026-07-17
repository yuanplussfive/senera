import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { CircleAlert, LoaderCircle, MoreHorizontal, PencilLine, SquarePen, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";
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
  showInlineActions: boolean;
  onRename: () => void;
  onClose: () => void;
}

export function SessionRow({
  active,
  sessionId,
  title,
  accent,
  onClick,
  showInlineActions,
  onRename,
  onClose,
}: SessionRowProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const { reduceMotion, disableMotion } = useMotionLevel();
  const animateSelection = !reduceMotion && !disableMotion;
  const actions: SessionMenuAction[] = [
    {
      id: "rename",
      label: frontendMessage("runtime.migrated.features.session.SessionRows.49.14"),
      icon: <PencilLine className="h-3.5 w-3.5" />,
      onSelect: onRename,
    },
    {
      id: "delete",
      label: frontendMessage("runtime.migrated.features.session.SessionRows.55.14"),
      icon: <Trash2 className="h-3.5 w-3.5" />,
      destructive: true,
      onSelect: onClose,
    },
  ];

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-session-row={sessionId}
          className={cn(
            "group relative isolate grid w-full items-center rounded-[9px] px-2.5 text-left transition-colors duration-150",
            showInlineActions ? "h-11" : "h-9",
            showInlineActions ? "grid-cols-[minmax(0,1fr)_28px] gap-1" : "grid-cols-1",
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
          <button
            type="button"
            aria-current={active ? "true" : undefined}
            aria-label={`打开会话：${title}`}
            onClick={onClick}
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
                <LoaderCircle
                  className="h-3 w-3 shrink-0 animate-spin text-umber-600"
                  aria-label={frontendMessage("session.statusRunning")}
                />
              ) : accent === "failed" ? (
                <CircleAlert
                  className="h-3 w-3 shrink-0 text-brick-600"
                  aria-label={frontendMessage("session.statusFailed")}
                />
              ) : null}
              <span
                title={title}
                className={cn(
                  "block min-w-0 max-w-full cursor-[inherit] select-none truncate text-[13px] leading-5 transition-colors duration-150",
                  active ? "font-medium" : "font-normal",
                )}
              >
                {title}
              </span>
            </div>
          </div>

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
        <ContextMenuLabel>{frontendMessage("runtime.migrated.features.session.SessionRows.141.27")}</ContextMenuLabel>
        <ContextSessionMenuItems actions={actions} separateLast />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function EmptyState({ onNewSession }: { onNewSession: () => void }): JSX.Element {
  return (
    <div className="mt-8 flex flex-col items-center px-4 text-center">
      <div className="text-[13px] text-content-secondary">
        {frontendMessage("runtime.migrated.features.session.SessionRows.152.54")}
      </div>
      <button
        type="button"
        onClick={onNewSession}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-content-secondary transition hover:bg-surface-hover hover:text-content-primary"
      >
        <SquarePen className="h-3 w-3" />
        {frontendMessage("runtime.migrated.features.session.SessionRows.159.9")}
      </button>
    </div>
  );
}
