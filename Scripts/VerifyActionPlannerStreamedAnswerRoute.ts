import assert from "node:assert/strict";
import path from "node:path";
import { AgentEventKinds } from "../Source/AgentSystem/AgentEvent.js";
import { AgentLoopStateMachine } from "../Source/AgentSystem/AgentLoopStateMachine.js";
import type { AgentActionPlanResult } from "../Source/AgentSystem/AgentActionPlanner.js";
import { EmptyActionPlannerLedger } from "../Source/AgentSystem/AgentActionPlannerContext.js";
import { AgentConfigLoader } from "../Source/AgentSystem/AgentConfigLoader.js";
import { AgentPluginRegistry } from "../Source/AgentSystem/AgentPluginRegistry.js";
import { AgentPluginScanner } from "../Source/AgentSystem/AgentPluginScanner.js";
import { AgentPromptContextBuilder } from "../Source/AgentSystem/AgentPromptContextBuilder.js";
import {
  AgentInteractionRunModes,
  type AgentInteractionRouteResult,
} from "../Source/AgentSystem/AgentInteractionRouter.js";
import { InteractionRunMode } from "../Source/AgentSystem/BamlClient/baml_client/types.js";

const workspaceRoot = process.cwd();
const config = AgentConfigLoader.load(path.join(workspaceRoot, "senera.config.json"));
const registry = new AgentPluginRegistry();
for (const plugin of new AgentPluginScanner(workspaceRoot, config).scan()) {
  registry.registerPlugin(plugin);
}
const promptContextBuilder = new AgentPromptContextBuilder(registry, config);

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
assert.equal(started.command?.kind, "route_interaction");

const directRoute: AgentInteractionRouteResult = {
  mode: AgentInteractionRunModes.DirectResponse,
  objective: "直接回答",
  needsFreshEvidence: false,
  needsWorkspaceRead: false,
  needsSideEffect: false,
  risk: "none",
  preferredTools: [],
  discoveryQueries: [],
  reason: "Conversation answer is sufficient.",
  raw: {
    mode: InteractionRunMode.DirectResponse,
    objective: "直接回答",
    needsFreshEvidence: false,
    needsWorkspaceRead: false,
    needsSideEffect: false,
    risk: "none",
    preferredTools: [],
    discoveryQueries: [],
    reason: "Conversation answer is sufficient.",
  },
};

const directRouted = machine.consume(started.state, {
  kind: "succeeded",
  output: {
    kind: "interaction_routed",
    requestId: "verify-streamed-answer-route",
    step: 1,
    route: directRoute,
    loadedToolNames: [],
    rootCommand: promptContextBuilder.buildRootCommand({
      decision: {
        action: "answer",
      },
      loadedToolNames: [],
    }),
    activeSkills: [],
  },
});

assert.equal(directRouted.state.kind, "running");
assert.equal(directRouted.command?.kind, "render_prompt");
assert.equal(directRouted.events.some((event) => event.kind === AgentEventKinds.ActionPlanned), false);

const plan: AgentActionPlanResult = {
  kind: "planned",
  selectedAction: "answer",
  selectionRepaired: false,
  payloadRepaired: false,
  input: {
    currentUserTurn: {
      content: "直接回答",
    },
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
      calls: [],
    },
    timeline: [{
      index: 0,
      role: "user",
      kind: "user_message",
      content: "直接回答",
      evidenceUris: [],
      artifactUris: [],
    }],
    evidenceMemory: [],
    evidenceState: [],
    plannerJournal: [],
    toolTagCatalog: [],
    compactToolCatalog: [],
    toolCatalog: [],
    activeSkills: [],
  },
  decision: {
    action: "answer",
  },
};
const rootCommand = promptContextBuilder.buildRootCommand({
  decision: plan.decision,
  loadedToolNames: [],
});

const secondStarted = machine.start({
  requestId: "verify-streamed-answer-route-planner",
  input: "直接回答",
  loadedToolNames: [],
  emitRunStarted: false,
});

assert.equal(secondStarted.state.kind, "running");
assert.equal(secondStarted.command?.kind, "route_interaction");

const plannerRoute: AgentInteractionRouteResult = {
  ...directRoute,
  mode: AgentInteractionRunModes.DeliberateTaskLoop,
  raw: {
    ...directRoute.raw,
    mode: InteractionRunMode.DeliberateTaskLoop,
  },
};

const plannedStart = machine.consume(secondStarted.state, {
  kind: "succeeded",
  output: {
    kind: "interaction_routed",
    requestId: "verify-streamed-answer-route-planner",
    step: 1,
    route: plannerRoute,
    loadedToolNames: [],
    activeSkills: [],
  },
});

assert.equal(plannedStart.state.kind, "running");
assert.equal(plannedStart.command?.kind, "plan_action");

const routed = machine.consume(plannedStart.state, {
  kind: "succeeded",
  output: {
    kind: "action_planned",
    requestId: "verify-streamed-answer-route-planner",
    step: 1,
    plan,
    loadedToolNames: [],
    plannerLedger: EmptyActionPlannerLedger,
    conversationEntries: [],
    rootCommand,
    activeSkills: [],
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
assert.equal(collecting.command.rootCommand, rootCommand);

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
