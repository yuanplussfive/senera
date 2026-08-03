import assert from "node:assert/strict";
import type { AgentRootCommand } from "../Source/AgentSystem/AgentRootCommand.js";
import { AgentTurnPreparationService } from "../Source/AgentSystem/Loop/AgentTurnPreparationService.js";
import type { AgentActivatedSkill } from "../Source/AgentSystem/Skills/AgentSkillActivation.js";
import { createAgentToolAccessGrant } from "../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";

const WorkspaceInspectionToolName = "ShellCommandTool";
const workflowSkill = workflowSkillFixture();
const resolutionCalls: Array<{ preferredTools?: readonly string[]; discover?: boolean }> = [];
let rememberedLoadedTools: readonly string[] | undefined;

const preparation = new AgentTurnPreparationService({
  services: {
    promptContext: {
      activateSkills: async () => [workflowSkill],
      recommendedSkillTools: (skills) => skills.flatMap((skill) => skill.recommendedTools),
      buildRootCommand: ({ decision, loadedToolNames }) =>
        rootCommandFixture(loadedToolNames, decision.action === "use_tools" ? decision.useTools.preferredTools : []),
    },
    retrieval: {
      resolvePlannedLoadedTools: async (options) => {
        resolutionCalls.push(options);
        return [...new Set([...(options.currentLoadedTools ?? []), ...(options.preferredTools ?? [])])];
      },
      rememberAutoSearch: (_requestId, _query, loadedToolNames) => {
        rememberedLoadedTools = loadedToolNames;
      },
    },
  },
});

const prepared = await preparation.prepare({
  requestId: "verify-pi-native-workflow-resource-routing",
  userInput: "继续全面优化拓展",
  loadedToolNames: ["SystemTool"],
});

assert.deepEqual(
  prepared.activeSkills.map((skill) => skill.name),
  ["execution-workflow"],
);
assert.equal(resolutionCalls.length, 1);
assert.deepEqual(resolutionCalls[0]?.preferredTools, [WorkspaceInspectionToolName]);
assert.equal(resolutionCalls[0]?.discover, true);
assert.deepEqual(prepared.loadedToolNames, ["SystemTool", WorkspaceInspectionToolName]);
assert.deepEqual(rememberedLoadedTools, prepared.loadedToolNames);
assert.equal(prepared.rootCommand.action, "use_tools");
assert.deepEqual(prepared.toolAccessGrant.preferredToolNames, [WorkspaceInspectionToolName]);

console.log("Pi-native deterministic workflow resource routing verified.");

function workflowSkillFixture(): AgentActivatedSkill {
  return {
    name: "execution-workflow",
    revision: "test-revision",
    title: "执行工作流",
    summary: "Pi-native workflow resource activation.",
    useCases: ["todo", "workflow", "until done"],
    avoid: [],
    recommendedTools: [WorkspaceInspectionToolName],
    evidenceRequirements: [],
    descriptionFile: "System/Skills/execution-workflow/SKILL.md",
    matchedTerms: ["workflow"],
    matchedFields: [{ term: "workflow", fields: ["summary"] }],
    score: 1,
  };
}

function rootCommandFixture(loadedToolNames: readonly string[], preferredTools: readonly string[]): AgentRootCommand {
  const toolAccessGrant = createAgentToolAccessGrant({
    authorizedToolNames: loadedToolNames,
    exposedToolNames: loadedToolNames,
    preferredToolNames: preferredTools,
  });
  return {
    authority: "senera_runtime_root",
    action: "use_tools",
    outputMode: "open",
    toolAccess: "restricted",
    objective: "完成当前用户请求。",
    instruction: "继续全面优化拓展",
    toolAccessGrant,
    forbiddenOutputs: ["unregistered_tools"],
    insufficiencyPolicy: "缺少工具能力时说明阻塞。",
    toolSearchQueries: [],
    needs: [],
    includeToolCatalog: false,
    visibleOutput: {
      audience: "runtime",
      start: "pi_tool_turn",
      format: "openai_tool_calls_or_final_text",
      rules: [],
      repair: { instruction: "按 Pi 工具调用协议重试。", rules: [] },
    },
  };
}
