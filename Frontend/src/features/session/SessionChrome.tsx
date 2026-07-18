import { ChevronDown, PanelLeftClose, PanelLeftOpen, SquarePen } from "lucide-react";
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

interface SessionHeaderProps {
  collapsed?: boolean;
  menuSections: readonly SessionMenuSection[];
  onNewSession: () => void;
  onToggleSidebar: () => void;
}

export function SessionHeader({
  collapsed = false,
  menuSections,
  onNewSession,
  onToggleSidebar,
}: SessionHeaderProps): JSX.Element {
  const { isCoarsePointer } = useResponsiveMode();

  if (collapsed) {
    return (
      <div
        className="flex shrink-0 flex-col items-center gap-1.5 px-1 pt-3"
        data-window-drag-region
        data-session-rail-header
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Senera"
              className="grid h-8 w-8 place-items-center rounded-lg text-content-primary transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
            >
              <LogoMark size={18} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" className="min-w-[226px]">
            <DropdownSessionMenuSections sections={menuSections} />
          </DropdownMenuContent>
        </DropdownMenu>

        <IconButton
          label={frontendMessage("session.new")}
          tone="muted"
          tooltip={frontendMessage("session.new")}
          tooltipSide="right"
          tooltipShortcut="⌘N"
          onClick={onNewSession}
          touchSafe
        >
          <SquarePen className="h-4 w-4" />
        </IconButton>
        <IconButton
          label={frontendMessage("session.headerExpand")}
          tone="muted"
          tooltip={frontendMessage("session.headerExpand")}
          tooltipSide="right"
          tooltipShortcut="⌘B"
          onClick={onToggleSidebar}
          touchSafe
          data-session-rail-expand
        >
          <PanelLeftOpen className="h-4 w-4" />
        </IconButton>
      </div>
    );
  }

  return (
    <div className="flex h-[52px] shrink-0 items-center gap-1.5 px-2.5" data-window-drag-region>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "group flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[9px] px-1.5 text-[13px] font-semibold text-content-primary transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
              isCoarsePointer && "min-h-11",
            )}
          >
            <LogoWordmark className="truncate" />
            <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-content-muted transition-transform duration-150 group-data-[state=open]:rotate-180" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[226px]">
          <DropdownSessionMenuSections sections={menuSections} />
        </DropdownMenuContent>
      </DropdownMenu>

      <IconButton
        label={frontendMessage("session.new")}
        tone="muted"
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
        tone="muted"
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
