import { DEFAULT_SESSION_TITLE } from "./defaults";
import { touchRun } from "./sessionRunProjection";
import type { EventSourceChannel } from "../../api/eventTypes";
import type { RunRecord, SessionRecord, StoreState, TimelineStep } from "./types";

export const nowIso = (): string => new Date().toISOString();

export function currentRun(session: SessionRecord, requestId?: string): RunRecord | undefined {
  if (!requestId) return session.runs[session.runs.length - 1];
  return session.runs.find((run) => run.requestId === requestId);
}

/** Resolve the run that owns the session's active request, with a defensive
 * status-based fallback for older snapshots that predate activeRequestId. */
export function readActiveRun(session: SessionRecord | undefined): RunRecord | undefined {
  if (!session) return undefined;
  if (session.activeRequestId) {
    const active = session.runs.find((run) => run.requestId === session.activeRequestId);
    if (active && isLiveRunStatus(active.status)) return active;
  }
  return [...session.runs].reverse().find((run) => isLiveRunStatus(run.status));
}

function isLiveRunStatus(status: RunRecord["status"]): boolean {
  return status === "running" || status === "cancelling";
}

export function ensureSession(state: StoreState, sessionId: string): SessionRecord {
  if (!state.sessions[sessionId]) {
    state.sessions[sessionId] = {
      sessionId,
      title: DEFAULT_SESSION_TITLE,
      status: "ready",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      entryCount: 0,
      messageCount: 0,
      messages: [],
      runs: [],
    };
    if (!state.sessionOrder.includes(sessionId)) {
      state.sessionOrder.unshift(sessionId);
    }
  }
  return state.sessions[sessionId];
}

/** Keep connector ownership visible as soon as the first scoped event arrives. */
export function projectSessionChannel(session: SessionRecord, channel?: EventSourceChannel): void {
  if (!channel || channel === "console") return;
  if (session.channel?.platform === channel) {
    session.channel = { ...session.channel, platform: channel };
    return;
  }
  session.channel = { platform: channel };
}

export function upsertStep(run: RunRecord, step: TimelineStep): void {
  const index = run.steps.findIndex((entry) => entry.id === step.id);
  if (index >= 0) {
    run.steps[index] = { ...run.steps[index], ...step };
  } else {
    run.steps.push(step);
  }
  touchRun(run);
}

export function syncSessionCountsFromLoadedMessages(session: SessionRecord): void {
  session.messageCount = session.messages.length;
}

export function bumpSessionMessageCount(session: SessionRecord): void {
  session.messageCount = Math.max(session.messageCount, session.messages.length);
}
