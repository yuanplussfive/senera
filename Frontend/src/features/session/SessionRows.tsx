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
            "group relative isolate mt-px grid w-full grid-cols-[minmax(0,1fr)_28px] items-center gap-1 rounded-md px-2.5 py-1.5 text-left transition-colors duration-150",
            "data-[state=open]:bg-ink-900/[0.055]",
            active ? "bg-ink-900/[0.055] text-ink-950" : "text-ink-700 hover:bg-ink-900/[0.035]",
          )}
        >
          <button
            type="button"
            aria-current={active ? "true" : undefined}
            aria-label={`打开会话：${title}`}
            onClick={onClick}
            className="absolute inset-0 z-10 cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-terra-300"
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
                className="block min-w-0 max-w-full truncate text-[13px] font-medium leading-tight cursor-[inherit] select-none"
              >
                {title}
              </span>
            </div>
            {active || accent !== "idle" ? (
              <div className="mt-0.5 truncate text-[10.5px] tabular-nums text-ink-450 cursor-[inherit] select-none">
                {subtitle}
              </div>
            ) : null}
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
                    menuOpen || showInlineActions
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                  )}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
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
      <div className="text-[13px] text-ink-700">
        {frontendMessage("runtime.migrated.features.session.SessionRows.152.54")}
      </div>
      <button
        type="button"
        onClick={onNewSession}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-ink-700 transition hover:bg-ink-900/[0.05] hover:text-ink-950"
      >
        <SquarePen className="h-3 w-3" />
        {frontendMessage("runtime.migrated.features.session.SessionRows.159.9")}
      </button>
    </div>
  );
}
