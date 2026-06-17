import { ChevronDown, MessageSquare, PencilLine, SquarePen, Trash2 } from "lucide-react";
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
      label: "重命名",
      icon: <PencilLine className="h-3.5 w-3.5" />,
      onSelect: onRename,
    },
    {
      id: "delete",
      label: "删除历史",
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
          onClick={onClick}
          whileTap={tapScale ? { scale: tapScale } : undefined}
          transition={motionTimings.fast}
          className={cn(
            "group relative isolate mt-0.5 grid w-full cursor-pointer grid-cols-[24px_minmax(0,1fr)_28px] items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
            "data-[state=open]:bg-ink-900/[0.055]",
            active
              ? "text-ink-900"
              : "text-ink-700 hover:bg-ink-900/[0.03]",
          )}
        >
          {active ? (
            <motion.span
              key={sessionId}
              layoutId="active-session-indicator"
              className="pointer-events-none absolute inset-0 z-0 rounded-lg bg-ink-900/[0.055]"
              transition={reduceMotion || disableMotion ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 42 }}
            />
          ) : null}
          <div className="relative z-10 mt-0.5 grid h-5 w-5 place-items-center">
            {accent === "running" ? (
              <span className="block h-1.5 w-1.5 rounded-full bg-umber-500 motion-safe:animate-pulse" />
            ) : accent === "failed" ? (
              <span className="block h-1.5 w-1.5 rounded-full bg-brick-500" />
            ) : (
              <MessageSquare className="h-3.5 w-3.5 text-ink-500" />
            )}
          </div>
          <div className="relative z-10 min-w-0 overflow-hidden pr-1">
            <div className="flex min-w-0 items-center gap-1">
              <span
                title={title}
                className="block min-w-0 max-w-full truncate text-[13px] font-medium leading-tight cursor-[inherit] select-none"
              >
                {title}
              </span>
            </div>
            <div className="mt-0.5 truncate font-mono text-[10.5px] text-ink-400 cursor-[inherit] select-none">
              {subtitle}
            </div>
          </div>

          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <IconButton
                label="more"
                size="sm"
                tone="muted"
                onClick={(e) => e.stopPropagation()}
                touchSafe
                className={cn(
                  "justify-self-end hover:bg-ink-900/[0.06]",
                  menuOpen || active || showInlineActions ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[190px]">
              <DropdownSessionMenuItems actions={actions} separateLast />
            </DropdownMenuContent>
          </DropdownMenu>
        </motion.div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[196px]">
        <ContextMenuLabel>会话操作</ContextMenuLabel>
        <ContextSessionMenuItems actions={actions} separateLast />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function EmptyState({ onNewSession }: { onNewSession: () => void }): JSX.Element {
  return (
    <div className="mt-8 flex flex-col items-center px-4 text-center">
      <LogoMark size={24} />
      <div className="mt-2 text-[13px] text-ink-700">还没有对话</div>
      <button
        type="button"
        onClick={onNewSession}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-ink-200 bg-paper-50 px-2.5 py-1 text-[12px] text-ink-800 transition hover:border-ink-300 hover:bg-paper-200/60"
      >
        <SquarePen className="h-3 w-3" />
        开始新对话
      </button>
    </div>
  );
}
