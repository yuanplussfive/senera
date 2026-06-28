import assert from "node:assert/strict";
import path from "node:path";
import { loadVerificationConfig } from "./VerificationConfig.js";
import { AgentLoopStateMachine } from "../Source/AgentSystem/Loop/AgentLoopStateMachine.js";
import { AgentPluginRegistry } from "../Source/AgentSystem/Plugin/AgentPluginRegistry.js";
import { AgentPluginScanner } from "../Source/AgentSystem/Plugin/AgentPluginScanner.js";
import { AgentPromptContextBuilder } from "../Source/AgentSystem/Prompt/AgentPromptContextBuilder.js";
import { EmptyActionPlannerLedger } from "../Source/AgentSystem/ActionPlanner/AgentActionPlannerContext.js";
import {
  AgentInteractionRunModes,
  type AgentInteractionRouteResult,
} from "../Source/AgentSystem/ActionPlanner/AgentInteractionRouter.js";
import { InteractionRunMode } from "../Source/AgentSystem/BamlClient/baml_client/types.js";

const workspaceRoot = process.cwd();
const config = loadVerificationConfig(workspaceRoot);
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
  requestId: "verify-tool-call-planner-short-circuit",
  input: "看看项目结构",
  loadedToolNames: ["FastContextWorkspaceMapTool"],
  emitRunStarted: false,
});

assert.equal(started.state.kind, "running");
assert.equal(started.command?.kind, "route_interaction");

const route: AgentInteractionRouteResult = {
  mode: AgentInteractionRunModes.ToolAgentLoop,
  objective: "查看项目结构",
  needsFreshEvidence: true,
  needsWorkspaceRead: true,
  needsSideEffect: false,
  risk: "read",
  preferredTools: ["FastContextWorkspaceMapTool"],
  discoveryQueries: [],
  reason: "Workspace inspection needs a tool observation.",
  raw: {
    mode: InteractionRunMode.ToolAgentLoop,
    objective: "查看项目结构",
    needsFreshEvidence: true,
    needsWorkspaceRead: true,
    needsSideEffect: false,
    risk: "read",
    preferredTools: ["FastContextWorkspaceMapTool"],
    discoveryQueries: [],
    reason: "Workspace inspection needs a tool observation.",
  },
};
const rootCommand = promptContextBuilder.buildRootCommand({
  decision: {
    action: "use_tools",
    useTools: {
      preferredTools: ["FastContextWorkspaceMapTool"],
      instruction: "查看项目结构",
      needs: [],
    },
  },
  loadedToolNames: ["FastContextWorkspaceMapTool"],
});

const routed = machine.consume(started.state, {
  kind: "succeeded",
  output: {
    kind: "interaction_routed",
    requestId: "verify-tool-call-planner-short-circuit",
    step: 1,
    route,
    loadedToolNames: ["FastContextWorkspaceMapTool"],
    rootCommand,
    activeSkills: [],
  },
});

assert.equal(routed.state.kind, "running");
assert.equal(routed.command?.kind, "collect_tool_call_plan");
if (routed.command?.kind !== "collect_tool_call_plan") {
  throw new Error("Expected collect_tool_call_plan command.");
}
assert.equal(routed.command.rootCommand, rootCommand);
assert.deepEqual(routed.command.plannerLedger, EmptyActionPlannerLedger);
assert.deepEqual(routed.command.loadedToolNames, ["FastContextWorkspaceMapTool"]);

const toolSearchTool = registry.listTools().find((tool) =>
  tool.handler.kind === "HostCapability"
  && tool.handler.capability === "tool.search"
);
assert.ok(toolSearchTool, "Expected one registered tool.search host capability.");

const discoveryRootCommand = promptContextBuilder.buildRootCommand({
  decision: {
    action: "discover_tools",
    discoverTools: {
      queries: ["查看项目结构"],
      needs: [],
    },
  },
  loadedToolNames: [toolSearchTool.name],
});
const recovered = machine.consume(routed.state, {
  kind: "succeeded",
  output: {
    kind: "tool_call_discovery_planned",
    requestId: "verify-tool-call-planner-short-circuit",
    step: 1,
    reason: "empty plan",
    issues: ["calls empty"],
    loadedToolNames: [toolSearchTool.name],
    rootCommand: discoveryRootCommand,
    activeSkills: [],
  },
});

assert.equal(recovered.state.kind, "running");
assert.equal(recovered.command?.kind, "collect_tool_call_plan");
if (recovered.command?.kind !== "collect_tool_call_plan") {
  throw new Error("Expected recovery collect_tool_call_plan command.");
}
assert.equal(recovered.command.rootCommand.action, "discover_tools");
assert.equal(recovered.command.toolPlanDiscoveryEscalated, true);
assert.equal((recovered.events[0]?.data as { status?: string } | undefined)?.status, "discovery_escalated");

console.log("Tool-call planner short-circuit verification passed.");
