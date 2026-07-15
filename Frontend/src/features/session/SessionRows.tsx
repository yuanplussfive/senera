import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { ChevronDown, CircleAlert, LoaderCircle, MessageSquare, PencilLine, SquarePen, Trash2 } from "lucide-react";
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
  LogoMark,
} from "../../shared/ui";
import { motionTimings, readTapScale, useMotionLevel } from "../../shared/motion";
import { ContextSessionMenuItems, DropdownSessionMenuItems } from "./SessionMenuActions";
import type { SessionMenuAction } from "./types";

interface SessionRowProps {
  active: boolean;
  sessionId: string;
  title: string;
  subtitle: string;
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
  subtitle,
  accent,
  onClick,
  showInlineActions,
  onRename,
  onClose,
}: SessionRowProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const { reduceMotion, disableMotion } = useMotionLevel();
  const tapScale = readTapScale(disableMotion || reduceMotion ? "reduced" : "full");
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
        <motion.div
          data-session-row={sessionId}
          whileTap={tapScale ? { scale: tapScale } : undefined}
          transition={motionTimings.fast}
          className={cn(
            "group relative isolate mt-0.5 grid w-full grid-cols-[22px_minmax(0,1fr)_28px] items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors duration-150",
            "data-[state=open]:bg-[var(--theme-session-active-bg)]",
            active ? "text-ink-900" : "text-ink-700 hover:bg-ink-900/[0.03]",
          )}
        >
          <button
            type="button"
            aria-current={active ? "true" : undefined}
            aria-label={`打开会话：${title}`}
            onClick={onClick}
            className="absolute inset-0 z-10 cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-terra-300"
          />
          {active ? (
            <motion.span
              key={sessionId}
              layoutId="active-session-indicator"
              className="pointer-events-none absolute inset-0 z-0 rounded-md bg-[var(--theme-elevated-bg)] shadow-[inset_2px_0_0_rgb(var(--color-terra-500)/0.78)]"
              transition={
                reduceMotion || disableMotion ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 42 }
              }
            />
          ) : null}
          <div className="pointer-events-none relative z-20 mt-0.5 grid h-5 w-5 place-items-center">
            {accent === "running" ? (
              <LoaderCircle
                className="h-3.5 w-3.5 animate-spin text-umber-600"
                aria-label={frontendMessage("session.statusRunning")}
              />
            ) : accent === "failed" ? (
              <CircleAlert
                className="h-3.5 w-3.5 text-brick-600"
                aria-label={frontendMessage("session.statusFailed")}
              />
            ) : (
              <MessageSquare className="h-3.5 w-3.5 text-ink-500" aria-hidden="true" />
            )}
          </div>
          <div className="pointer-events-none relative z-20 min-w-0 overflow-hidden pr-1">
            <div className="flex min-w-0 items-center gap-1">
              <span
                title={title}
                className="block min-w-0 max-w-full truncate text-[13px] font-medium leading-tight cursor-[inherit] select-none"
              >
                {title}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[10.5px] tabular-nums text-ink-400 cursor-[inherit] select-none">
              {subtitle}
            </div>
          </div>

          <div className="relative z-20">
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <IconButton
                  label="more"
                  size="sm"
                  tone="muted"
                  touchSafe
                  className={cn(
                    "justify-self-end hover:bg-ink-900/[0.06]",
                    menuOpen || active || showInlineActions
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                  )}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[190px]">
                <DropdownSessionMenuItems actions={actions} separateLast />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </motion.div>
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
      <LogoMark size={24} />
      <div className="mt-2 text-[13px] text-ink-700">
        {frontendMessage("runtime.migrated.features.session.SessionRows.152.54")}
      </div>
      <button
        type="button"
        onClick={onNewSession}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-ink-200 bg-paper-50 px-2.5 py-1 text-[12px] text-ink-800 transition hover:border-ink-300 hover:bg-paper-200/60"
      >
        <SquarePen className="h-3 w-3" />
        {frontendMessage("runtime.migrated.features.session.SessionRows.159.9")}
      </button>
    </div>
  );
}
