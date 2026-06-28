import {
  EventKinds,
  type DecisionXmlProgressData,
  type ModelDeltaData,
  type ModelStartedData,
} from "../../api/eventTypes";
import { readCurrentRun, type RunEventHandlerMap } from "./runEventProjectionTypes";
import { upsertStep } from "./sessionProjectorCore";
import {
  alignRunDisplayTarget,
  isToolCallStreamPrefix,
  projectStreamingVisibility,
  touchRun,
} from "./sessionRunProjection";

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
    run.visibleKind = run.expectedOutputMode === "tool_call_xml" ? "tool_calls" : "unknown";
    run.decisionMode = run.expectedOutputMode === "tool_call_xml" ? "tool_candidate" : "none";
    upsertStep(run, {
      id: `${run.requestId}-model-${env.step ?? 0}`,
      kind: "model",
      title: "调用模型",
      description: `第 ${env.step ?? 0} 步`,
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

  [EventKinds.DecisionXmlProgress]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as DecisionXmlProgressData;
    run.xmlPreview = data.xml;
    if (run.expectedOutputMode === "tool_call_xml" || data.kind === "tool_calls") {
      run.decisionMode = "tool_candidate";
      run.visibleText = "";
      run.displayText = "";
      run.visibleKind = "tool_calls";
      touchRun(run);
      return;
    }
    if (
      run.decisionMode === "tool_candidate" &&
      isToolCallStreamPrefix(run.streamingRaw)
    ) {
      run.visibleText = "";
      run.displayText = "";
      run.visibleKind = "unknown";
      touchRun(run);
      return;
    }
    run.decisionMode = "none";
    run.visibleText = data.text || run.streamingRaw;
    run.visibleKind = data.kind;
    alignRunDisplayTarget(run);
    touchRun(run);
  },
} satisfies RunEventHandlerMap;
