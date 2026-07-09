import type { EventEnvelope } from "../../api/eventTypes";
import { currentRun } from "./sessionProjectorCore";
import type { RunRecord, StoreState } from "./types";

export type RunEventHandler = (state: StoreState, env: EventEnvelope) => void;
export type RunEventHandlerMap = Partial<Record<EventEnvelope["kind"], RunEventHandler>>;

export function readCurrentRun(
  state: StoreState,
  env: EventEnvelope,
): RunRecord | undefined {
  const sessionId = env.sessionId;
  if (!sessionId) return undefined;
  const session = state.sessions[sessionId];
  if (!session) return undefined;
  return currentRun(session, env.requestId);
}
