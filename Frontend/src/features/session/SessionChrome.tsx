import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { SessionChannelMessageKeys } from "./sessionChannelPresentation";
import { DesktopReleaseChannelBadge } from "../../app/DesktopReleaseChannelBadge";
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

export type SessionChannelFilter = "all" | EventSourceChannel;

interface SessionHeaderProps {
  collapsed?: boolean;
  compactFrame?: boolean;
  /**
   * Electron computes drag regions from layout boxes, not paint or pointer-events.
   * Hidden surfaces must drop the attribute or they keep swallowing clicks.
   */
  dragRegion?: boolean;
  onNewSession: () => void;
  onToggleSidebar: () => void;
}

export function SessionHeader({
  collapsed = false,
  compactFrame = false,
  dragRegion = true,
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
        data-window-drag-region={dragRegion || undefined}
        data-session-rail-header
        data-session-header
      >
        <span className="grid h-8 w-8 place-items-center text-content-primary" aria-hidden="true">
          <LogoMark size={18} />
        </span>

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
      data-window-drag-region={dragRegion || undefined}
      data-session-header
    >
      <div
        className={cn(
          "flex h-8 min-w-0 flex-1 items-center gap-2 px-1.5 text-[13px] font-semibold text-content-primary",
          isCoarsePointer && "min-h-11",
        )}
        data-session-brand
      >
        <LogoMark size={18} />
        <LogoWordmark className="truncate" />
        <DesktopReleaseChannelBadge />
      </div>

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
          data-session-rail-collapse
        >
          <AppIcon icon="panel-left-close" className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}

/**
 * Channel scope for the session list. It belongs beside the search field
 * because it narrows the same collection; the title bar no longer owns it.
 */
export function SessionChannelFilterMenu({
  value,
  onChange,
}: {
  value: SessionChannelFilter;
  onChange: (value: SessionChannelFilter) => void;
}): JSX.Element {
  const active = value !== "all";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label={frontendMessage("session.channel.filter")}
          tooltip={frontendMessage("session.channel.filter")}
          tooltipSide="bottom"
          size="md"
          tone={active ? "primary" : "muted"}
          aria-haspopup="menu"
        >
          <AppIcon icon="filter" className="h-4 w-4" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
