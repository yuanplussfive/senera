import type { EventEnvelope } from "../../api/eventTypes";
import { runApprovalEventHandlers } from "./runApprovalProjector";
import { runDecisionEventHandlers } from "./runDecisionProjector";
import { type RunEventHandlerMap } from "./runEventProjectionTypes";
import { runLifecycleEventHandlers } from "./runLifecycleProjector";
import { runModelStreamEventHandlers } from "./runModelStreamProjector";
import { runToolAndAnswerEventHandlers } from "./runToolAndAnswerProjector";
import { runInteractionInputEventHandlers } from "./runInteractionInputProjector";
import type { StoreState } from "./types";
import { runActivityEventHandlers } from "./runActivityProjector";

const runEventHandlers: RunEventHandlerMap = {
  ...runLifecycleEventHandlers,
  ...runActivityEventHandlers,
  ...runDecisionEventHandlers,
  ...runModelStreamEventHandlers,
  ...runApprovalEventHandlers,
  ...runInteractionInputEventHandlers,
  ...runToolAndAnswerEventHandlers,
};

export function projectRunEvent(state: StoreState, env: EventEnvelope): boolean {
  const handler = runEventHandlers[env.kind];
  if (!handler) return false;
  handler(state, env);
  return true;
}
