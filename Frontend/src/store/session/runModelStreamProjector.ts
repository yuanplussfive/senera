import {
  EventKinds,
  type ModelDeltaData,
  type ModelCompletedData,
  type ModelStartedData,
  type ModelThinkingCompletedData,
  type ModelThinkingDeltaData,
} from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { readCurrentRun, type RunEventHandlerMap } from "./runEventProjectionTypes";
import { upsertStep } from "./sessionProjectorCore";
import { alignRunDisplayTarget, isRunTerminal, projectStreamingVisibility, touchRun } from "./sessionRunProjection";

export const runModelStreamEventHandlers = {
  [EventKinds.ModelStarted]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    if (isRunTerminal(run)) return;
    const data = env.data as ModelStartedData;
    const modelName = data.provider?.model ?? data.model;
    if (data.provider) run.modelProvider = data.provider;
    if (data.messageIndex !== undefined) {
      run.activeModelRequest = {
        agentStep: env.step ?? 0,
        modelMessageIndex: data.messageIndex,
        eventSequence: env.sequence,
      };
    }
    run.streamingRaw = "";
    run.xmlPreview = "";
    run.visibleText = "";
    run.displayText = "";
    run.displayMessageId = undefined;
    if (run.outputState !== "available" && run.outputState !== "committed") run.outputState = "pending";
    run.visibleKind = "unknown";
    run.decisionMode = run.plannedDecisionMode ?? "none";
    run.plannedDecisionMode = undefined;
    upsertStep(run, {
      id: `${run.requestId}-model-${env.step ?? 0}-${data.messageIndex ?? "request"}`,
      kind: "model",
      agentStep: env.step,
      modelMessageIndex: data.messageIndex,
      eventSequence: env.sequence,
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
    if (data.messageIndex !== undefined) {
      run.activeModelRequest = {
        agentStep: env.step ?? 0,
        modelMessageIndex: data.messageIndex,
        eventSequence: env.sequence,
      };
    }
    run.streamingRaw += data.text;
    if (run.outputState === "pending") run.outputState = "streaming";
    projectStreamingVisibility(run);
    alignRunDisplayTarget(run);
    touchRun(run);
  },

  [EventKinds.ModelThinkingDelta]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ModelThinkingDeltaData;
    if (!data.delta) return;
    run.activeModelRequest = {
      agentStep: env.step ?? 0,
      modelMessageIndex: data.messageIndex,
      eventSequence: env.sequence,
    };
    const block = findOrCreateThinkingBlock(run, env.step, env.sequence, data);
    block.content += data.delta;
    block.status = "streaming";
    touchRun(run);
  },

  [EventKinds.ModelThinkingCompleted]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ModelThinkingCompletedData;
    const block = findOrCreateThinkingBlock(run, env.step, env.sequence, data);
    block.content = data.content;
    block.status = data.status;
    touchRun(run);
  },

  [EventKinds.ModelCompleted]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as ModelCompletedData;
    if (data.provider) run.modelProvider = data.provider;
    const step = run.steps.find(
      (item) => item.id === `${run.requestId}-model-${env.step ?? 0}-${data.messageIndex ?? "request"}`,
    );
    if (step) {
      step.status = "done";
      step.endedAt = env.timestamp;
      step.completedSequence = env.sequence;
      touchRun(run);
    }
    if (data.messageIndex !== undefined && run.activeModelRequest?.modelMessageIndex === data.messageIndex) {
      run.activeModelRequest = undefined;
    }
  },
} satisfies RunEventHandlerMap;

function findOrCreateThinkingBlock(
  run: NonNullable<ReturnType<typeof readCurrentRun>>,
  step: number | undefined,
  eventSequence: number,
  data: Pick<ModelThinkingDeltaData, "messageIndex" | "contentIndex">,
) {
  const resolvedStep = step ?? 0;
  const id = `step:${resolvedStep}:message:${data.messageIndex}:content:${data.contentIndex}`;
  run.thinkingBlocks ??= [];
  let block = run.thinkingBlocks.find((entry) => entry.id === id);
  if (!block) {
    block = {
      id,
      step: resolvedStep,
      messageIndex: data.messageIndex,
      contentIndex: data.contentIndex,
      eventSequence,
      content: "",
      status: "streaming",
    };
    run.thinkingBlocks.push(block);
  }
  return block;
}
