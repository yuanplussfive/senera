import assert from "node:assert/strict";
import { AgentEventKinds } from "../Source/AgentSystem/AgentEvent.js";
import { AgentLoopStateMachine } from "../Source/AgentSystem/AgentLoopStateMachine.js";
import {
  AgentInteractionRunModes,
  type AgentInteractionRouteResult,
} from "../Source/AgentSystem/AgentInteractionRouter.js";
import { InteractionRunMode } from "../Source/AgentSystem/BamlClient/baml_client/types.js";

const machine = new AgentLoopStateMachine({
  maxSteps: 4,
  maxRepairAttempts: 1,
  dynamicTools: true,
});

const started = machine.start({
  requestId: "verify-interaction-routing-loop",
  input: "你好",
  loadedToolNames: [],
  emitRunStarted: false,
});

assert.equal(started.state.kind, "running");
assert.equal(started.command?.kind, "route_interaction");

const directRoute = routeFixture(AgentInteractionRunModes.DirectResponse);
const directTransition = machine.consume(started.state, {
  kind: "succeeded",
  output: {
    kind: "interaction_routed",
    requestId: "verify-interaction-routing-loop",
    step: 1,
    route: directRoute,
    loadedToolNames: [],
    activeSkills: [],
  },
});

assert.equal(directTransition.state.kind, "running");
assert.equal(directTransition.command?.kind, "render_prompt");
assert.equal(
  directTransition.events.some((event) => event.kind === AgentEventKinds.InteractionRouted),
  true,
);
assert.equal(
  directTransition.events.some((event) => event.kind === AgentEventKinds.ActionPlanned),
  false,
);

const toolStarted = machine.start({
  requestId: "verify-interaction-routing-tool-loop",
  input: "看看项目结构",
  loadedToolNames: ["FastContextWorkspaceMapTool"],
  emitRunStarted: false,
});

assert.equal(toolStarted.state.kind, "running");
assert.equal(toolStarted.command?.kind, "route_interaction");

const toolTransition = machine.consume(toolStarted.state, {
  kind: "succeeded",
  output: {
    kind: "interaction_routed",
    requestId: "verify-interaction-routing-tool-loop",
    step: 1,
    route: routeFixture(AgentInteractionRunModes.ToolAgentLoop),
    loadedToolNames: ["FastContextWorkspaceMapTool"],
    activeSkills: [],
  },
});

assert.equal(toolTransition.state.kind, "running");
assert.equal(toolTransition.command?.kind, "render_prompt");
assert.equal(
  toolTransition.events.some((event) => event.kind === AgentEventKinds.InteractionRouted),
  true,
);

const deliberateStarted = machine.start({
  requestId: "verify-interaction-routing-deliberate-loop",
  input: "修改代码并测试",
  loadedToolNames: [],
  emitRunStarted: false,
});

assert.equal(deliberateStarted.state.kind, "running");
assert.equal(deliberateStarted.command?.kind, "route_interaction");

const deliberateTransition = machine.consume(deliberateStarted.state, {
  kind: "succeeded",
  output: {
    kind: "interaction_routed",
    requestId: "verify-interaction-routing-deliberate-loop",
    step: 1,
    route: routeFixture(AgentInteractionRunModes.DeliberateTaskLoop),
    loadedToolNames: [],
    activeSkills: [],
  },
});

assert.equal(deliberateTransition.state.kind, "running");
assert.equal(deliberateTransition.command?.kind, "plan_action");
assert.equal(
  deliberateTransition.events.some((event) => event.kind === AgentEventKinds.InteractionRouted),
  true,
);

console.log("Interaction routing loop verification passed.");

function routeFixture(mode: AgentInteractionRouteResult["mode"]): AgentInteractionRouteResult {
  return {
    mode,
    objective: "verify route",
    needsFreshEvidence: mode !== AgentInteractionRunModes.DirectResponse,
    needsWorkspaceRead: mode !== AgentInteractionRunModes.DirectResponse,
    needsSideEffect: mode === AgentInteractionRunModes.DeliberateTaskLoop,
    risk: mode === AgentInteractionRunModes.DeliberateTaskLoop ? "write" : "none",
    preferredTools: [],
    discoveryQueries: [],
    reason: "Fixture route.",
    raw: {
      mode: rawMode(mode),
      objective: "verify route",
      needsFreshEvidence: mode !== AgentInteractionRunModes.DirectResponse,
      needsWorkspaceRead: mode !== AgentInteractionRunModes.DirectResponse,
      needsSideEffect: mode === AgentInteractionRunModes.DeliberateTaskLoop,
      risk: mode === AgentInteractionRunModes.DeliberateTaskLoop ? "write" : "none",
      preferredTools: [],
      discoveryQueries: [],
      reason: "Fixture route.",
    },
  };
}

function rawMode(mode: AgentInteractionRouteResult["mode"]): InteractionRunMode {
  switch (mode) {
    case AgentInteractionRunModes.DirectResponse:
      return InteractionRunMode.DirectResponse;
    case AgentInteractionRunModes.ToolAgentLoop:
      return InteractionRunMode.ToolAgentLoop;
    case AgentInteractionRunModes.DeliberateTaskLoop:
      return InteractionRunMode.DeliberateTaskLoop;
  }
}
