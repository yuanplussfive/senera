import { EventKinds, type PromptSummaryData } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { readCurrentRun, type RunEventHandlerMap } from "./runEventProjectionTypes";
import { upsertStep } from "./sessionProjectorCore";

export const runDecisionEventHandlers = {
  [EventKinds.PromptSummary]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as PromptSummaryData;
    upsertStep(run, {
      id: `${run.requestId}-prompt-${env.step ?? 0}`,
      kind: "prompt",
      title: frontendMessage("workflow.plan.promptRendered"),
      description: frontendMessage("workflow.projection.stepIndex", { step: env.step ?? 0 }),
      status: "done",
      startedAt: env.timestamp,
      endedAt: env.timestamp,
      promptChars: data.chars,
      promptLines: data.lines,
      promptTokenCount: data.tokenCount,
    });
  },
} satisfies RunEventHandlerMap;
