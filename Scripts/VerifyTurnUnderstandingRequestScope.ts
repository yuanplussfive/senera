import assert from "node:assert/strict";
import { AgentLoopStateMachine } from "../Source/AgentSystem/Loop/AgentLoopStateMachine.js";
import { EmptyActionPlannerLedger } from "../Source/AgentSystem/ActionPlanner/AgentActionPlannerContext.js";
import { TurnContextMode } from "../Source/AgentSystem/BamlClient/baml_client/types.js";

const requestId = "verify-turn-understanding-request-scope";
const machine = new AgentLoopStateMachine({
  maxSteps: 4,
  maxRepairAttempts: 1,
  dynamicTools: true,
});

const started = machine.start({
  requestId,
  input: "那北京呢？",
  loadedToolNames: ["WeatherTool"],
  emitRunStarted: false,
});

assert.equal(started.state.kind, "running");

const turnUnderstanding = {
  rawUserTurn: "那北京呢？",
  standaloneRequest: "查询北京明天天气",
  contextMode: TurnContextMode.Used,
  contextBasis: "上一轮用户询问上海明天天气。",
  missingContext: "",
};

const routedState = {
  ...started.state,
  turnUnderstanding,
};

const advanced = machine.consume(routedState, {
  kind: "succeeded",
  output: {
    kind: "tool_results_generated",
    requestId,
    step: routedState.step,
    responseText: "<tool_results />",
    resultXml: "<tool_results />",
    execution: {
      kind: "ToolResults",
      value: [],
    },
    messages: [
      {
        role: "user",
        content: "那北京呢？",
      },
    ],
    conversationEntries: [],
    loadedToolNames: ["WeatherTool"],
    plannerLedger: EmptyActionPlannerLedger,
  },
});

assert.equal(advanced.state.kind, "running");
assert.equal(advanced.command?.kind, "route_interaction");
if (advanced.command?.kind !== "route_interaction") {
  throw new Error("Expected route_interaction after tool results.");
}
assert.deepEqual(advanced.command.turnUnderstanding, turnUnderstanding);

console.log("Turn understanding request-scope verification passed.");
