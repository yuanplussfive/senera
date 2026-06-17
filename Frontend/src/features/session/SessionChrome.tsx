import { ChevronDown, PanelLeftClose, PanelLeftOpen, SquarePen } from "lucide-react";
import { cn } from "../../lib/util";
import { useResponsiveMode } from "../../shared/responsive";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  LogoMark,
  LogoWordmark,
  Tooltip,
} from "../../shared/ui";
import { DropdownSessionMenuSections } from "./SessionMenuActions";
import type { SessionMenuSection } from "./types";

interface SessionRailProps {
  socketStatus: string;
  onNewSession: () => void;
  onOpenSessionPanel: () => void;
}

interface SessionHeaderProps {
  menuSections: readonly SessionMenuSection[];
  onNewSession: () => void;
  onToggleSidebar: () => void;
}

export function SessionRail({
  socketStatus,
  onNewSession,
  onOpenSessionPanel,
}: SessionRailProps): JSX.Element {
  return (
    <aside className="flex h-full w-[56px] shrink-0 flex-col items-center border-r border-ink-200/70 bg-paper-100/60 py-3">
      <IconButton
        label="expand"
        tooltip="展开侧栏"
        tooltipSide="right"
        tooltipShortcut="⌘B"
        onClick={onOpenSessionPanel}
        touchSafe
      >
        <PanelLeftOpen className="h-4 w-4" />
      </IconButton>
      <div className="my-2 flex flex-col items-center">
        <LogoMark size={22} />
      </div>
      <IconButton label="new" tooltip="新建对话" tooltipSide="right" onClick={onNewSession} touchSafe>
        <SquarePen className="h-4 w-4" />
      </IconButton>
      <div className="mt-auto pb-1">
        <ConnectionDot status={socketStatus} />
      </div>
    </aside>
  );
}

export function SessionHeader({
  menuSections,
  onNewSession,
  onToggleSidebar,
}: SessionHeaderProps): JSX.Element {
  const { isCoarsePointer } = useResponsiveMode();

  return (
    <div className="flex h-14 items-center gap-1.5 px-2.5">
      <IconButton
        label="collapse"
        tooltip="收起侧栏"
        tooltipSide="bottom"
        tooltipShortcut="⌘B"
        onClick={onToggleSidebar}
        touchSafe
      >
        <PanelLeftClose className="h-4 w-4" />
      </IconButton>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "group flex h-8 flex-1 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-ink-800 transition hover:bg-ink-900/[0.05]",
              isCoarsePointer && "min-h-11",
            )}
          >
            <LogoMark size={16} />
            <LogoWordmark className="text-[15px]" />
            <ChevronDown className="ml-auto h-3.5 w-3.5 text-ink-400 transition group-data-[state=open]:rotate-180" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[226px]">
          <DropdownSessionMenuSections sections={menuSections} />
        </DropdownMenuContent>
      </DropdownMenu>

      <IconButton
        label="new"
        tooltip="新建对话"
        tooltipSide="bottom"
        tooltipShortcut="⌘N"
        onClick={onNewSession}
        touchSafe
      >
        <SquarePen className="h-4 w-4" />
      </IconButton>
    </div>
  );
}

function ConnectionDot({ status }: { status: string }): JSX.Element {
  const color =
    status === "open"
      ? "bg-moss-500"
      : status === "connecting" || status === "idle"
        ? "bg-umber-500 motion-safe:animate-pulse"
        : "bg-brick-500";
  const label =
    status === "open"
      ? "已连接"
      : status === "connecting" || status === "idle"
        ? "连接中"
        : "未连接";
  return (
    <Tooltip content={label} side="right">
      <button type="button" className="grid h-6 w-6 place-items-center">
        <span className={cn("block h-2 w-2 rounded-full", color)} />
      </button>
    </Tooltip>
  );
}
