import type { RunActivity } from "../../api/eventTypes";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";

export const RunActivityPresentationPriorities = {
  Ambient: "ambient",
  Foreground: "foreground",
} as const;

export type RunActivityPresentationPriority =
  (typeof RunActivityPresentationPriorities)[keyof typeof RunActivityPresentationPriorities];

const RunActivityPresentation = {
  preparing_context: { labelKey: "workflow.activity.preparingContext", priority: "foreground" },
  initializing_runtime: { labelKey: "workflow.activity.initializingRuntime", priority: "foreground" },
  synchronizing_context: { labelKey: "workflow.activity.synchronizingContext", priority: "foreground" },
  evaluating_context: { labelKey: "workflow.activity.evaluatingContext", priority: "foreground" },
  compacting_context: { labelKey: "workflow.activity.compactingContext", priority: "foreground" },
  running_agent_turn: { labelKey: "workflow.activity.runningAgentTurn", priority: "ambient" },
  generating_response: { labelKey: "workflow.activity.generatingResponse", priority: "foreground" },
  finalizing_response: { labelKey: "workflow.activity.finalizingResponse", priority: "foreground" },
} as const satisfies Record<
  RunActivity,
  { readonly labelKey: FrontendMessageKey; readonly priority: RunActivityPresentationPriority }
>;

export function runActivityLabel(activity: RunActivity): string {
  return frontendMessage(RunActivityPresentation[activity].labelKey);
}

export function activeRunActivityLabel(activity: RunActivity): string {
  return frontendMessage("workflow.activity.running", {
    activity: runActivityLabel(activity),
  });
}

export function runActivityPresentationPriority(activity: RunActivity): RunActivityPresentationPriority {
  return RunActivityPresentation[activity].priority;
}
