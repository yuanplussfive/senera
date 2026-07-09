import assert from "node:assert/strict";
import { AgentEventKinds } from "../Source/AgentSystem/Events/AgentEvent.js";
import { AgentLoopStateMachine } from "../Source/AgentSystem/Loop/AgentLoopStateMachine.js";
import { consumeTurnUnderstood } from "./ActionPlannerFixture.js";
import {
  AgentInteractionRunModes,
  type AgentInteractionRouteResult,
} from "../Source/AgentSystem/ActionPlanner/AgentInteractionRouter.js";
import type { AgentRootCommand } from "../Source/AgentSystem/AgentRootCommand.js";
import { InteractionRunMode } from "../Source/AgentSystem/BamlClient/baml_client/types.js";

const machine = new AgentLoopStateMachine();

const started = machine.start({
  requestId: "verify-pi-agent-loop-substrate",
  input: "使用工具检查项目",
  loadedToolNames: ["WorkspaceListDirectory"],
  emitRunStarted: false,
});
const understood = consumeTurnUnderstood(machine, started);

assert.equal(understood.state.kind, "running");
const routed = machine.consume(understood.state, {
  kind: "succeeded",
  output: {
    kind: "interaction_routed",
    requestId: "verify-pi-agent-loop-substrate",
    step: 1,
    route: routeFixture(),
    loadedToolNames: ["WorkspaceListDirectory"],
    rootCommand: rootCommandFixture(),
    activeSkills: [],
  },
});

assert.equal(routed.state.kind, "running");
assert.equal(routed.command?.kind, "render_prompt");
if (routed.state.kind === "running") {
  assert.equal(routed.state.rootCommand?.outputMode, "open");
}

const piTurn = machine.consume(routed.state, {
  kind: "succeeded",
  output: {
    kind: "prompt_rendered",
    requestId: "verify-pi-agent-loop-substrate",
    step: 1,
    prompt: "<agent_system></agent_system>",
    promptTokenCount: 1,
  },
});

assert.equal(piTurn.state.kind, "running");
assert.equal(piTurn.command?.kind, "run_pi_turn");
if (piTurn.command?.kind !== "run_pi_turn") {
  throw new Error("Expected run_pi_turn command.");
}
assert.deepEqual(piTurn.command.loadedToolNames, ["WorkspaceListDirectory"]);
assert.equal(piTurn.events.some((event) => event.kind === AgentEventKinds.PromptSummary), true);

const completed = machine.consume(piTurn.state, {
  kind: "succeeded",
  output: {
    kind: "pi_turn_completed",
    requestId: "verify-pi-agent-loop-substrate",
    step: 1,
    responseText: "Pi 底座完成回复。",
    modelProvider: {
      id: "verification-provider",
      kind: "OpenAICompatible",
      endpoint: "ChatCompletions",
      baseUrl: "https://example.invalid/v1",
      model: "verification-model",
    },
    usage: {
      source: "local_estimate",
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    },
    messages: [{
      role: "user",
      content: "使用工具检查项目",
    }, {
      role: "assistant",
      content: "Pi 底座完成回复。",
    }],
    conversationEntries: [],
    stepTraces: [{
      step: 1,
      seq: 0,
      kind: "tool",
      status: "done",
      toolName: "WorkspaceListDirectory",
      callId: "call_verify",
    }, {
      step: 1,
      seq: 1,
      kind: "answer",
      status: "done",
      decisionKind: "final_answer",
    }],
    executedTools: [],
  },
});

assert.equal(completed.state.kind, "completed");
assert.equal(completed.command, undefined);
assert.equal(completed.events.some((event) =>
  event.kind === AgentEventKinds.AssistantMessageCreated
  && event.data.kind === "final_answer"), true);
assert.equal(completed.events.some((event) => event.kind === AgentEventKinds.RunCompleted), true);
if (completed.state.kind === "completed") {
  assert.equal(completed.state.result.terminal.kind, "FinalAnswer");
  assert.equal(completed.state.result.stepTraces.length, 2);
}

console.log("Pi agent loop substrate verification passed.");

function routeFixture(): AgentInteractionRouteResult {
  return {
    mode: AgentInteractionRunModes.ToolAgentLoop,
    objective: "使用工具检查项目",
    needsFreshEvidence: true,
    needsWorkspaceRead: true,
    needsSideEffect: false,
    risk: "read",
    preferredTools: ["WorkspaceListDirectory"],
    discoveryQueries: [],
    reason: "Tool route is delegated to Pi substrate.",
    raw: {
      mode: InteractionRunMode.ToolAgentLoop,
      objective: "使用工具检查项目",
      needsFreshEvidence: true,
      needsWorkspaceRead: true,
      needsSideEffect: false,
      risk: "read",
      preferredTools: ["WorkspaceListDirectory"],
      discoveryQueries: [],
      reason: "Tool route is delegated to Pi substrate.",
    },
  };
}

function rootCommandFixture(): AgentRootCommand {
  return {
    authority: "senera_runtime_root",
    action: "use_tools",
    outputMode: "open",
    toolAccess: "restricted",
    objective: "通过 Pi 工具循环检查项目。",
    instruction: "检查当前工作区。",
    allowedTools: ["WorkspaceListDirectory"],
    forbiddenOutputs: ["unregistered_tools"],
    insufficiencyPolicy: "缺少工具能力时说明阻塞。",
    preferredTools: ["WorkspaceListDirectory"],
    toolSearchQueries: [],
    needs: [],
    includeToolCatalog: false,
    visibleOutput: {
      audience: "runtime",
      start: "pi_tool_turn",
      format: "openai_tool_calls_or_final_text",
      rules: [],
      repair: {
        instruction: "按 Pi 工具调用协议重试。",
        rules: [],
      },
    },
  };
}
