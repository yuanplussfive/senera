import { DEFAULT_SESSION_TITLE } from "./defaults";
import { touchRun } from "./sessionRunProjection";
import type {
  RunRecord,
  SessionRecord,
  StoreState,
  TimelineStep,
} from "./types";

export const nowIso = (): string => new Date().toISOString();

export function currentRun(
  session: SessionRecord,
  requestId?: string,
): RunRecord | undefined {
  if (!requestId) return session.runs[session.runs.length - 1];
  return session.runs.find((run) => run.requestId === requestId);
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
