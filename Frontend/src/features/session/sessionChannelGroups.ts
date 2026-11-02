import type { EventSourceChannel } from "../../api/eventTypes";
import type { SessionListEntry } from "../../store/selectors/chatSelectors";

/** Presentation limit only; search and bulk selection still address the complete filtered catalog. */
export const SessionChannelPreviewCount = 5;

export interface SessionChannelGroup {
  readonly channel: EventSourceChannel;
  readonly sessions: readonly SessionListEntry[];
}

/** Input is already scoped to the active workspace. Equal timestamps preserve catalog order. */
export function groupSessionsByChannel(sessions: readonly SessionListEntry[]): readonly SessionChannelGroup[] {
  const groups = new Map<EventSourceChannel, SessionListEntry[]>();
  const sorted = [...sessions].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  for (const session of sorted) {
    const group = groups.get(session.platform);
    if (group) group.push(session);
    else groups.set(session.platform, [session]);
  }
  // Insertion order reflects each channel's latest conversation activity.
  return [...groups].map(([channel, entries]) => ({ channel, sessions: entries }));
}

export function visibleChannelSessions(
  group: SessionChannelGroup,
  expanded: boolean,
  activeSessionId: string | null,
): readonly SessionListEntry[] {
  if (expanded || group.sessions.length <= SessionChannelPreviewCount) return group.sessions;
  const first = group.sessions.slice(0, SessionChannelPreviewCount);
  const active = group.sessions.find((session) => session.sessionId === activeSessionId);
  // Keep the current conversation reachable without growing the preview beyond its limit.
  if (active && !first.includes(active)) first[first.length - 1] = active;
  return first;
}
