import type { EventEnvelope } from "../../api/eventTypes";
import { runApprovalEventHandlers } from "./runApprovalProjector";
import { runDecisionEventHandlers } from "./runDecisionProjector";
import { type RunEventHandlerMap } from "./runEventProjectionTypes";
import { runLifecycleEventHandlers } from "./runLifecycleProjector";
import { runModelStreamEventHandlers } from "./runModelStreamProjector";
import { runPiTraceEventHandlers } from "./runPiTraceProjector";
import { runToolAndAnswerEventHandlers } from "./runToolAndAnswerProjector";
import type { StoreState } from "./types";

const runEventHandlers: RunEventHandlerMap = {
  ...runLifecycleEventHandlers,
  ...runDecisionEventHandlers,
  ...runModelStreamEventHandlers,
  ...runPiTraceEventHandlers,
  ...runApprovalEventHandlers,
  ...runToolAndAnswerEventHandlers,
};

export function projectRunEvent(state: StoreState, env: EventEnvelope): boolean {
  const handler = runEventHandlers[env.kind];
  if (!handler) return false;
  handler(state, env);
  return true;
}
