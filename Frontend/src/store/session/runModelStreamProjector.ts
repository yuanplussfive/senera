import { EventKinds, type ModelDeltaData, type ModelStartedData } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { readCurrentRun, type RunEventHandlerMap } from "./runEventProjectionTypes";
import { upsertStep } from "./sessionProjectorCore";
import { alignRunDisplayTarget, projectStreamingVisibility, touchRun } from "./sessionRunProjection";

export const runModelStreamEventHandlers = {
  [EventKinds.ModelStarted]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ModelStartedData;
    const modelName = data.provider?.model ?? data.model;
    run.modelProvider = data.provider;
    run.streamingRaw = "";
    run.xmlPreview = "";
    run.visibleText = "";
    run.displayText = "";
    run.displayMessageId = undefined;
    run.visibleKind = "unknown";
    run.decisionMode = run.plannedDecisionMode ?? "none";
    run.plannedDecisionMode = undefined;
    upsertStep(run, {
      id: `${run.requestId}-model-${env.step ?? 0}`,
      kind: "model",
      title: frontendMessage("workflow.feed.callingModel"),
      description: frontendMessage("workflow.projection.stepIndex", { step: env.step ?? 0 }),
      status: "running",
      startedAt: env.timestamp,
      modelName,
    });
  },

  [EventKinds.ModelDelta]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ModelDeltaData;
    run.streamingRaw += data.text;
    projectStreamingVisibility(run);
    alignRunDisplayTarget(run);
    touchRun(run);
  },

  [EventKinds.ModelCompleted]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const step = run.steps.find((item) => item.id === `${run.requestId}-model-${env.step ?? 0}`);
    if (step) {
      step.status = "done";
      step.endedAt = env.timestamp;
      touchRun(run);
    }
  },
} satisfies RunEventHandlerMap;
