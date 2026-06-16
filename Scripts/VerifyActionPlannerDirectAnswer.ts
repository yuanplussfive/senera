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
  requestId: "verify-direct-answer",
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
    answer: {
      content: "这是 planner 的直接回复。",
    },
  },
};
assert.equal(plan.kind, "planned");

const completed = machine.consume(started.state, {
  kind: "succeeded",
  output: {
    kind: "action_planned",
    requestId: "verify-direct-answer",
    step: 1,
    plan,
    loadedToolNames: [],
    plannerLedger: EmptyActionPlannerLedger,
    conversationEntries: [],
    actionDirective: plan.decision,
  },
});

assert.equal(completed.command, undefined);
assert.equal(completed.state.kind, "completed");
if (completed.state.kind !== "completed") {
  throw new Error("Expected completed state.");
}
assert.deepEqual(completed.state.result.terminal, {
  kind: "FinalAnswer",
  content: "这是 planner 的直接回复。",
});
assert.equal(completed.events.some((event) => event.kind === AgentEventKinds.ActionPlanned), true);
assert.equal(completed.events.some((event) => event.kind === AgentEventKinds.FinalAnswer), true);
assert.equal(completed.events.some((event) => event.kind === AgentEventKinds.RunCompleted), true);

console.log("Action planner direct answer verification passed.");
