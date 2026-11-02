import type { StoreState } from "./types";

export type RunHistoryDetailLoadState = "loading" | "loaded";

export function beginRunHistoryDetailLoad(state: StoreState, sessionId: string, requestId: string): boolean {
  const sessionStates = (state.runHistoryDetailStates[sessionId] ??= {});
  if (sessionStates[requestId]) return false;
  sessionStates[requestId] = "loading";
  return true;
}

export function completeRunHistoryDetailLoad(state: StoreState, sessionId: string, requestId: string): void {
  const sessionStates = (state.runHistoryDetailStates[sessionId] ??= {});
  sessionStates[requestId] = "loaded";
}

export function abandonRunHistoryDetailLoad(state: StoreState, sessionId: string, requestId: string): void {
  const sessionStates = state.runHistoryDetailStates[sessionId];
  if (!sessionStates || sessionStates[requestId] !== "loading") return;
  delete sessionStates[requestId];
  if (Object.keys(sessionStates).length === 0) delete state.runHistoryDetailStates[sessionId];
}

export function clearRunHistoryDetailState(state: StoreState, sessionId: string, requestId?: string): void {
  if (!requestId) {
    delete state.runHistoryDetailStates[sessionId];
    return;
  }
  const sessionStates = state.runHistoryDetailStates[sessionId];
  if (!sessionStates) return;
  delete sessionStates[requestId];
  if (Object.keys(sessionStates).length === 0) delete state.runHistoryDetailStates[sessionId];
}

/** A disconnected transport cannot complete an in-flight detail request. */
export function abandonPendingRunHistoryDetailLoads(state: StoreState): void {
  for (const [sessionId, sessionStates] of Object.entries(state.runHistoryDetailStates)) {
    for (const [requestId, status] of Object.entries(sessionStates)) {
      if (status === "loading") delete sessionStates[requestId];
    }
    if (Object.keys(sessionStates).length === 0) delete state.runHistoryDetailStates[sessionId];
  }
}
