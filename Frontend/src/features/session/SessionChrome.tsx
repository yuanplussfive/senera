import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import type { EventSourceChannel } from "../../api/eventTypes";
import { cn } from "../../lib/util";
import { useResponsiveMode } from "../../shared/responsive";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  AppIcon,
  IconButton,
  LogoMark,
  LogoWordmark,
} from "../../shared/ui";

type SessionChannelFilter = "all" | EventSourceChannel;

const SessionChannelMessageKeys = {
  all: "session.channel.all",
  console: "session.channel.console",
  qq: "session.channel.qq",
  telegram: "session.channel.telegram",
  discord: "session.channel.discord",
} as const satisfies Record<SessionChannelFilter, FrontendMessageKey>;

interface SessionHeaderProps {
  collapsed?: boolean;
  compactFrame?: boolean;
  channelFilter: SessionChannelFilter;
  onChannelFilterChange: (value: SessionChannelFilter) => void;
  onNewSession: () => void;
  onToggleSidebar: () => void;
}

export function SessionHeader({
  collapsed = false,
  compactFrame = false,
  channelFilter,
  onChannelFilterChange,
  onNewSession,
  onToggleSidebar,
}: SessionHeaderProps): JSX.Element {
  const { hasPersistentSessionPanel, isCoarsePointer, supportsHover } = useResponsiveMode();
  const compactHeaderActions = hasPersistentSessionPanel && supportsHover;
  const headerActionTouchSafe = !compactHeaderActions;

  if (collapsed) {
    return (
      <div
        className="flex shrink-0 flex-col items-center gap-1.5 px-1 pt-3"
        data-window-drag-region
        data-session-rail-header
        data-session-header
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
            <SessionChannelMenu value={channelFilter} onChange={onChannelFilterChange} />
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex flex-col gap-1">
          <IconButton
            label={frontendMessage("session.new")}
            size="md"
            tone="muted"
            tooltip={frontendMessage("session.new")}
            tooltipSide="right"
            tooltipShortcut="⌘N"
            onClick={onNewSession}
            touchSafe={headerActionTouchSafe}
          >
            <AppIcon icon="new-session" className="h-4 w-4" />
          </IconButton>
          <IconButton
            label={frontendMessage("session.headerExpand")}
            size="md"
            tone="muted"
            tooltip={frontendMessage("session.headerExpand")}
            tooltipSide="right"
            tooltipShortcut="⌘B"
            onClick={onToggleSidebar}
            touchSafe={headerActionTouchSafe}
            data-session-rail-expand
          >
            <AppIcon icon="panel-left-open" className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1.5 px-2.5",
        compactFrame ? "h-8 px-0" : "h-[var(--senera-top-chrome-height)]",
      )}
      data-window-drag-region
      data-session-header
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "group flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[9px] px-1.5 text-[13px] font-semibold text-content-primary transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
              isCoarsePointer && "min-h-11",
            )}
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <LogoMark size={18} />
              <LogoWordmark className="truncate" />
            </span>
            <AppIcon
              icon="chevron-down"
              className="ml-auto h-3.5 w-3.5 shrink-0 text-content-muted transition-transform duration-150 group-data-[state=open]:rotate-180"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[226px]">
          <SessionChannelMenu value={channelFilter} onChange={onChannelFilterChange} />
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex items-center gap-1">
        <IconButton
          label={frontendMessage("session.new")}
          size="md"
          tone="muted"
          tooltip={frontendMessage("session.new")}
          tooltipSide="bottom"
          tooltipShortcut="⌘N"
          onClick={onNewSession}
          touchSafe={headerActionTouchSafe}
        >
          <AppIcon icon="new-session" className="h-4 w-4" />
        </IconButton>
        <IconButton
          label={frontendMessage("session.headerCollapse")}
          size="md"
          tone="muted"
          tooltip={frontendMessage("session.headerCollapse")}
          tooltipSide="bottom"
          tooltipShortcut="⌘B"
          onClick={onToggleSidebar}
          touchSafe={headerActionTouchSafe}
        >
          <AppIcon icon="panel-left-close" className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}

function SessionChannelMenu({
  value,
  onChange,
}: {
  value: SessionChannelFilter;
  onChange: (value: SessionChannelFilter) => void;
}): JSX.Element {
  return (
    <>
      <DropdownMenuLabel>{frontendMessage("session.channel.filter")}</DropdownMenuLabel>
      {(Object.keys(SessionChannelMessageKeys) as SessionChannelFilter[]).map((option) => (
        <DropdownMenuItem
          key={option}
          icon={
            <span className="grid h-3.5 w-3.5 place-items-center" aria-hidden="true">
              {option === value ? <AppIcon icon="check" size={14} /> : null}
            </span>
          }
          onSelect={() => onChange(option)}
        >
          {frontendMessage(SessionChannelMessageKeys[option])}
        </DropdownMenuItem>
      ))}
    </>
  );
}
