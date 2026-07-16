import { ChevronDown, PanelLeftClose, SquarePen } from "lucide-react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { useResponsiveMode } from "../../shared/responsive";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, IconButton, LogoWordmark } from "../../shared/ui";
import { DropdownSessionMenuSections } from "./SessionMenuActions";
import type { SessionMenuSection } from "./types";

interface SessionHeaderProps {
  menuSections: readonly SessionMenuSection[];
  onNewSession: () => void;
  onToggleSidebar: () => void;
}

export function SessionHeader({ menuSections, onNewSession, onToggleSidebar }: SessionHeaderProps): JSX.Element {
  const { isCoarsePointer } = useResponsiveMode();

  return (
    <div className="flex h-[52px] shrink-0 items-center gap-1.5 px-2.5" data-window-drag-region>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "group flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-[13px] font-medium text-ink-800 transition-colors duration-150 hover:bg-ink-900/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
              isCoarsePointer && "min-h-11",
            )}
          >
            <LogoWordmark className="truncate" />
            <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-ink-400 transition-transform duration-150 group-data-[state=open]:rotate-180" />
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
    </div>
  );
}
