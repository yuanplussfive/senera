import assert from "node:assert/strict";
import { AgentEventKinds } from "../Source/AgentSystem/AgentEvent.js";
import { AgentLoopStateMachine } from "../Source/AgentSystem/AgentLoopStateMachine.js";
import type { AgentActionPlanResult } from "../Source/AgentSystem/AgentActionPlanner.js";
import { EmptyActionPlannerLedger } from "../Source/AgentSystem/AgentActionPlannerContext.js";

const machine = new AgentLoopStateMachine({
  maxSteps: 4,
  maxRepairAttempts: 1,
  dynamicTools: true,
});

const started = machine.start({
  requestId: "verify-streamed-answer-route",
  input: "直接回答",
  loadedToolNames: [],
  emitRunStarted: false,
});

assert.equal(started.state.kind, "running");
assert.equal(started.command?.kind, "plan_action");

const plan: AgentActionPlanResult = {
  kind: "planned",
  selectedAction: "answer",
  selectionRepaired: false,
  payloadRepaired: false,
  input: {
    runState: {
      currentStep: 1,
      dynamicTools: true,
      loadedTools: [],
      progress: {
        totalToolCalls: 0,
        totalEvidence: 0,
        lastNewEvidenceStep: 0,
        repeatedCallCount: 0,
        stalled: false,
      },
      warnings: [],
    },
    timeline: [{
      index: 0,
      role: "user",
      kind: "user_message",
      content: "直接回答",
      evidenceRefs: [],
      artifactUris: [],
    }],
    evidenceMemory: [],
    plannerJournal: [],
    toolCatalog: [],
  },
  decision: {
    action: "answer",
  },
};

const routed = machine.consume(started.state, {
  kind: "succeeded",
  output: {
    kind: "action_planned",
    requestId: "verify-streamed-answer-route",
    step: 1,
    plan,
    loadedToolNames: [],
    plannerLedger: EmptyActionPlannerLedger,
    conversationEntries: [],
    actionDirective: plan.decision,
  },
});

assert.equal(routed.state.kind, "running");
assert.equal(routed.command?.kind, "render_prompt");
assert.equal(routed.events.some((event) => event.kind === AgentEventKinds.ActionPlanned), true);
assert.equal(routed.events.some((event) => event.kind === AgentEventKinds.FinalAnswer), false);
assert.equal(routed.events.some((event) => event.kind === AgentEventKinds.RunCompleted), false);

const collecting = machine.consume(routed.state, {
  kind: "succeeded",
  output: {
    kind: "prompt_rendered",
    requestId: "verify-streamed-answer-route",
    step: 1,
    prompt: "<agent_system></agent_system>",
    promptTokenCount: 1,
  },
});

assert.equal(collecting.state.kind, "running");
assert.equal(collecting.command?.kind, "collect_decision_xml");
if (collecting.command?.kind !== "collect_decision_xml") {
  throw new Error("Expected collect_decision_xml command.");
}
assert.equal(collecting.command.actionDirective, plan.decision);

const completed = machine.consume(collecting.state, {
  kind: "succeeded",
  output: {
    kind: "final_text_collected",
    requestId: "verify-streamed-answer-route",
    step: 1,
    responseText: "这是主模型流式路径收集后的最终回复。",
    modelProvider: {
      id: "verification-provider",
      kind: "openai-compatible",
      endpoint: "openai-chat",
      baseUrl: "https://example.invalid/v1",
      model: "verification-model",
    },
    usage: {
      source: "local_estimate",
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    },
  },
});

assert.equal(completed.command, undefined);
assert.equal(completed.state.kind, "completed");
assert.equal(completed.events.some((event) => event.kind === AgentEventKinds.FinalAnswer), true);
assert.equal(completed.events.some((event) => event.kind === AgentEventKinds.RunCompleted), true);

console.log("Action planner streamed answer route verification passed.");
