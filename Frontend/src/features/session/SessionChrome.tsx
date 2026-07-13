import { ChevronDown, PanelLeftClose, PanelLeftOpen, Settings2, SquarePen } from "lucide-react";
import { openSettingsSurface } from "../../app/desktopBridge";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { useResponsiveMode } from "../../shared/responsive";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  LogoMark,
  LogoWordmark,
} from "../../shared/ui";
import { DropdownSessionMenuSections } from "./SessionMenuActions";
import type { SessionMenuSection } from "./types";

interface SessionRailProps {
  onNewSession: () => void;
  onOpenSessionPanel: () => void;
}

interface SessionHeaderProps {
  menuSections: readonly SessionMenuSection[];
  onNewSession: () => void;
  onToggleSidebar: () => void;
}

export function SessionRail({ onNewSession, onOpenSessionPanel }: SessionRailProps): JSX.Element {
  return (
    <aside className="flex h-full w-[56px] shrink-0 flex-col items-center border-r border-ink-200/70 bg-paper-100/60 py-3">
      <IconButton
        label={frontendMessage("session.headerExpand")}
        tooltip={frontendMessage("session.headerExpand")}
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
      <IconButton
        label={frontendMessage("session.new")}
        tooltip={frontendMessage("session.new")}
        tooltipSide="right"
        onClick={onNewSession}
        touchSafe
      >
        <SquarePen className="h-4 w-4" />
      </IconButton>
      <div className="mt-auto pb-1">
        <IconButton
          label={frontendMessage("pluginConfig.viewSettings")}
          tooltip={frontendMessage("pluginConfig.viewSettings")}
          tooltipSide="right"
          onClick={() => {
            void openSettingsSurface({
              fallback: () => undefined,
            });
          }}
          touchSafe
        >
          <Settings2 className="h-4 w-4" />
        </IconButton>
      </div>
    </aside>
  );
}

export function SessionHeader({ menuSections, onNewSession, onToggleSidebar }: SessionHeaderProps): JSX.Element {
  const { isCoarsePointer } = useResponsiveMode();

  return (
    <div className="flex h-14 items-center gap-1.5 px-2.5">
      <IconButton
        label={frontendMessage("session.headerCollapse")}
        tooltip={frontendMessage("session.headerCollapse")}
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
        label={frontendMessage("session.new")}
        tooltip={frontendMessage("session.new")}
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
