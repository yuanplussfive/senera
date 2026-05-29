import { ChevronDown, MessageSquare, PencilLine, SquarePen, Trash2 } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/util";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/ContextMenu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/DropdownMenu";
import { LogoMark } from "../ui/Logo";
import type { SessionAction } from "./types";

interface SessionRowProps {
  active: boolean;
  title: string;
  subtitle: string;
  accent: "idle" | "running" | "failed";
  onClick: () => void;
  onRename: () => void;
  onClose: () => void;
}

export function SessionRow({
  active,
  title,
  subtitle,
  accent,
  onClick,
  onRename,
  onClose,
}: SessionRowProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const actions: SessionAction[] = [
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
        <div
          onClick={onClick}
          className={cn(
            "group relative mt-0.5 grid cursor-pointer grid-cols-[24px_minmax(0,1fr)_28px] items-start gap-2 rounded-lg px-2.5 py-2 transition",
            "data-[state=open]:bg-ink-900/[0.055]",
            active
              ? "bg-ink-900/[0.055] text-ink-900"
              : "text-ink-700 hover:bg-ink-900/[0.03]",
          )}
        >
          <div className="mt-0.5 grid h-5 w-5 place-items-center">
            {accent === "running" ? (
              <span className="block h-1.5 w-1.5 rounded-full bg-terra-500 shadow-[0_0_0_4px_rgba(179,68,31,0.18)]" />
            ) : accent === "failed" ? (
              <span className="block h-1.5 w-1.5 rounded-full bg-brick-500" />
            ) : (
              <MessageSquare className="h-3.5 w-3.5 text-ink-500" />
            )}
          </div>
          <div className="min-w-0 overflow-hidden pr-1">
            <div className="flex min-w-0 items-center gap-1">
              <span
                title={title}
                className="block min-w-0 max-w-full truncate text-[13px] font-medium leading-tight"
              >
                {title}
              </span>
            </div>
            <div className="mt-0.5 truncate font-mono text-[10.5px] text-ink-400">
              {subtitle}
            </div>
          </div>

          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "grid h-6 w-6 place-items-center justify-self-end rounded text-ink-400 transition hover:bg-ink-900/[0.06] hover:text-ink-800",
                  menuOpen || active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
                aria-label="more"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[190px]">
              <DropdownSessionActions actions={actions} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[196px]">
        <ContextMenuLabel>会话操作</ContextMenuLabel>
        <ContextSessionActions actions={actions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function DropdownSessionActions({ actions }: { actions: SessionAction[] }): JSX.Element {
  return (
    <>
      {actions.map((action, index) => (
        <div key={action.id}>
          {index === actions.length - 1 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem
            icon={action.icon}
            destructive={action.destructive}
            onSelect={action.onSelect}
          >
            {action.label}
          </DropdownMenuItem>
        </div>
      ))}
    </>
  );
}

function ContextSessionActions({ actions }: { actions: SessionAction[] }): JSX.Element {
  return (
    <>
      {actions.map((action, index) => (
        <div key={action.id}>
          {index === actions.length - 1 ? <ContextMenuSeparator /> : null}
          <ContextMenuItem
            icon={action.icon}
            destructive={action.destructive}
            onSelect={action.onSelect}
          >
            {action.label}
          </ContextMenuItem>
        </div>
      ))}
    </>
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
