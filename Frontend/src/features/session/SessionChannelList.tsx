import { LayoutGroup } from "framer-motion";
import { useId, useMemo, useRef, useState } from "react";
import type { EventSourceChannel } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { FluidHoverHighlight, MotionDisclosure, useFluidHover, useMotionLevel } from "../../shared/motion";
import { AppIcon, Button } from "../../shared/ui";
import type { SessionListEntry } from "../../store/selectors/chatSelectors";
import { SessionRow } from "./SessionRows";
import { groupSessionsByChannel, SessionChannelPreviewCount, visibleChannelSessions } from "./sessionChannelGroups";
import { SessionChannelIcon, SessionChannelMessageKeys } from "./sessionChannelPresentation";

interface SessionChannelListProps {
  sessions: readonly SessionListEntry[];
  activeSessionId: string | null;
  revealAll: boolean;
  selectionMode: boolean;
  selectedSessionIds: ReadonlySet<string>;
  onSelectSession: (id: string) => void;
  onToggleSessionSelection: (id: string) => void;
  onRenameSession: (session: SessionListEntry, returnFocus: HTMLElement | null) => void;
  onDeleteSession: (session: SessionListEntry, returnFocus: HTMLElement | null) => void;
}

export function SessionChannelList({
  sessions,
  activeSessionId,
  revealAll,
  selectionMode,
  selectedSessionIds,
  onSelectSession,
  onToggleSessionSelection,
  onRenameSession,
  onDeleteSession,
}: SessionChannelListProps): JSX.Element {
  const [expandedChannels, setExpandedChannels] = useState<ReadonlySet<EventSourceChannel>>(() => new Set());
  const [collapsedChannels, setCollapsedChannels] = useState<ReadonlySet<EventSourceChannel>>(() => new Set());
  const groups = useMemo(() => groupSessionsByChannel(sessions), [sessions]);
  const visibleGroups = groups.map((group) => ({
    ...group,
    open: revealAll || !collapsedChannels.has(group.channel),
    visible: visibleChannelSessions(group, revealAll || expandedChannels.has(group.channel), activeSessionId),
  }));
  const visibleEntries = visibleGroups.flatMap((group) => group.visible);
  const indices = new Map(visibleEntries.map((session, index) => [session.sessionId, index]));
  const listRef = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(listRef, { axis: "y", requireContainment: true, gapClick: false });
  const { disableMotion } = useMotionLevel();
  const id = useId();
  const activeIndex = visibleEntries.findIndex((session) => session.sessionId === activeSessionId);

  return (
    <div ref={listRef} className="relative space-y-3" data-session-list {...hover.handlers}>
      <FluidHoverHighlight
        hover={hover}
        hidden={disableMotion || hover.activeIndex === activeIndex}
        className="rounded-md"
        data-session-fluid-hover
      />
      <LayoutGroup id={id}>
        {visibleGroups.map((group) => {
          const label = frontendMessage(SessionChannelMessageKeys[group.channel]);
          const expanded = expandedChannels.has(group.channel);
          const listId = `${id}-${group.channel}`;
          return (
            <section key={group.channel} aria-label={label} data-session-channel={group.channel}>
              <h3 className="mb-0.5">
                <button
                  type="button"
                  className="grid h-8 w-full min-w-0 grid-cols-[16px_minmax(0,1fr)_auto_12px] items-center gap-2 rounded-md px-2.5 text-left text-[11.5px] font-medium text-content-muted transition-colors hover:bg-surface-hover hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-focus disabled:cursor-default disabled:hover:bg-transparent"
                  aria-expanded={group.open}
                  aria-controls={listId}
                  aria-label={frontendMessage(group.open ? "session.channel.collapse" : "session.channel.expand", {
                    name: label,
                  })}
                  disabled={revealAll}
                  onClick={() =>
                    setCollapsedChannels((current) => {
                      const next = new Set(current);
                      if (next.has(group.channel)) next.delete(group.channel);
                      else next.add(group.channel);
                      return next;
                    })
                  }
                >
                  <span className="grid h-4 w-4 shrink-0 place-items-center">
                    <SessionChannelIcon channel={group.channel} />
                  </span>
                  <span className="min-w-0 truncate">{label}</span>
                  <span
                    data-session-channel-count
                    className="inline-grid aspect-square min-h-5 min-w-5 place-items-center justify-self-end rounded-full bg-surface-hover px-1 text-[10px] leading-none tabular-nums text-content-secondary"
                  >
                    {group.sessions.length}
                  </span>
                  <AppIcon
                    icon="chevron-right"
                    size={12}
                    className={
                      group.open
                        ? "rotate-90 transition-transform motion-reduce:transition-none"
                        : "transition-transform motion-reduce:transition-none"
                    }
                  />
                </button>
              </h3>
              <MotionDisclosure id={listId} open={group.open} strategy="stable">
                <div className="space-y-0.5">
                  {group.visible.map((session) => {
                    const index = indices.get(session.sessionId)!;
                    return (
                      <SessionRow
                        key={session.sessionId}
                        index={index}
                        registerItem={group.open ? hover.registerItem : undefined}
                        fluidHoverEnabled={!disableMotion}
                        active={session.sessionId === activeSessionId}
                        sessionId={session.sessionId}
                        title={session.title}
                        accent={session.accent}
                        selectionMode={selectionMode}
                        selected={selectedSessionIds.has(session.sessionId)}
                        onClick={() => onSelectSession(session.sessionId)}
                        onToggleSelected={() => onToggleSessionSelection(session.sessionId)}
                        onRename={(returnFocus) => onRenameSession(session, returnFocus)}
                        onClose={(returnFocus) => onDeleteSession(session, returnFocus)}
                        onFocus={() => hover.setActiveIndex(index)}
                      />
                    );
                  })}
                </div>
                {!revealAll && group.sessions.length > SessionChannelPreviewCount ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-0.5 h-8 w-full justify-start rounded-md px-2.5 text-[11px] font-normal text-content-muted hover:shadow-none"
                    aria-expanded={expanded}
                    aria-controls={listId}
                    onClick={() =>
                      setExpandedChannels((current) => {
                        const next = new Set(current);
                        if (next.has(group.channel)) next.delete(group.channel);
                        else next.add(group.channel);
                        return next;
                      })
                    }
                  >
                    <span className="flex items-center gap-2">
                      <span className="grid h-4 w-4 shrink-0 place-items-center">
                        <AppIcon icon={expanded ? "chevron-up" : "chevron-down"} size={12} />
                      </span>
                      <span>
                        {frontendMessage(expanded ? "session.channel.showLess" : "session.channel.showMore", {
                          count: group.sessions.length - group.visible.length,
                        })}
                      </span>
                    </span>
                  </Button>
                ) : null}
              </MotionDisclosure>
            </section>
          );
        })}
      </LayoutGroup>
    </div>
  );
}
