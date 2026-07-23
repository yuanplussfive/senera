import type { RunActivity } from "../../api/eventTypes";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";

const RunActivityLabelKeys = {
  preparing_context: "workflow.activity.preparingContext",
  initializing_runtime: "workflow.activity.initializingRuntime",
  synchronizing_context: "workflow.activity.synchronizingContext",
  evaluating_context: "workflow.activity.evaluatingContext",
  running_agent_turn: "workflow.activity.runningAgentTurn",
  generating_response: "workflow.activity.generatingResponse",
  finalizing_response: "workflow.activity.finalizingResponse",
} as const satisfies Record<RunActivity, FrontendMessageKey>;

export function runActivityLabel(activity: RunActivity): string {
  return frontendMessage(RunActivityLabelKeys[activity]);
}

export function activeRunActivityLabel(activity: RunActivity): string {
  return frontendMessage("workflow.activity.running", {
    activity: runActivityLabel(activity),
  });
}
