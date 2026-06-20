import assert from "node:assert/strict";
import path from "node:path";
import { AgentConfigLoader } from "../Source/AgentSystem/AgentConfigLoader.js";
import { resolveToolSearchConfig } from "../Source/AgentSystem/AgentDefaults.js";
import { AgentPluginRegistry } from "../Source/AgentSystem/AgentPluginRegistry.js";
import { AgentPluginScanner } from "../Source/AgentSystem/AgentPluginScanner.js";
import { AgentPromptContextBuilder } from "../Source/AgentSystem/AgentPromptContextBuilder.js";
import { AgentPromptRenderer } from "../Source/AgentSystem/AgentPromptRenderer.js";
import { AgentToolSearchRuntime } from "../Source/AgentSystem/AgentToolSearchRuntime.js";
import type { AgentActionDecision } from "../Source/AgentSystem/AgentActionPlanner.js";

void main();

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const config = AgentConfigLoader.load(path.join(workspaceRoot, "senera.config.json"));
  const registry = new AgentPluginRegistry();
  for (const plugin of new AgentPluginScanner(workspaceRoot, config).scan()) {
    registry.registerPlugin(plugin);
  }

  const search = new AgentToolSearchRuntime(
    registry,
    resolveToolSearchConfig(config),
    workspaceRoot,
  );

  const discovered = search.resolvePlannedLoadedTools({
    input: "需要修改文件",
    loadedTools: "dynamic",
    currentLoadedTools: ["ToolSearchTool", "AskUserTool"],
    queries: ["edit workspace file"],
    needs: [{
      actions: ["edit", "patch"],
      targets: ["workspace", "file"],
      inputs: ["path", "content"],
      outputs: ["workspace-file-change"],
      evidence: ["workspace-file"],
      effects: ["write-workspace"],
    }],
    discover: true,
  });
  assert.ok(
    discovered !== "all" && discovered.includes("ApplyPatchTool"),
    "DiscoverTools needs should load ApplyPatchTool from capability facets",
  );

  const useTools: AgentActionDecision = {
    action: "use_tools",
    useTools: {
      preferredTools: ["FastContextWorkspaceMapTool"],
      instruction: "Inspect the workspace structure.",
      needs: [],
    },
  };
  const promptRenderer = new AgentPromptRenderer();
  const promptContextBuilder = new AgentPromptContextBuilder(registry, config);
  const useToolsRootCommand = promptContextBuilder.buildRootCommand({
    decision: useTools,
    loadedToolNames: ["ToolSearchTool", "FastContextWorkspaceMapTool"],
  });
  const promptContext = promptContextBuilder.buildBaseContext({
    loadedToolNames: ["ToolSearchTool", "FastContextWorkspaceMapTool"],
    rootCommand: useToolsRootCommand,
  });
  const template = registry.getTemplate("BaseSystemPrompt");
  assert.ok(template, "BaseSystemPrompt template should be registered");
  const directiveText = await promptRenderer.renderFile(template.path, {
    ...promptContext,
  });
  assert.ok(directiveText.includes("<senera_root_command>"));
  assert.ok(directiveText.includes("<action>use_tools</action>"));
  assert.ok(directiveText.includes("<instruction>Inspect the workspace structure.</instruction>"));
  assert.ok(directiveText.includes("<tool>FastContextWorkspaceMapTool</tool>"));
  assert.ok(directiveText.includes("<tool_protocol>"));
  assert.ok(!directiveText.includes("<intent>"));
  assert.ok(!directiveText.includes("<confidence>"));
  assert.ok(!directiveText.includes("<required_capabilities>"));
  assert.ok(!directiveText.includes("<tags>"));

  const answer: AgentActionDecision = {
    action: "answer",
  };
  const answerRootCommand = promptContextBuilder.buildRootCommand({
    decision: answer,
    loadedToolNames: ["ToolSearchTool"],
  });
  const answerContext = promptContextBuilder.buildBaseContext({
    loadedToolNames: ["ToolSearchTool"],
    rootCommand: answerRootCommand,
  });
  const answerDirectiveText = await promptRenderer.renderFile(template.path, {
    ...answerContext,
  });
  assert.ok(answerDirectiveText.includes("<senera_root_command>"));
  assert.ok(answerDirectiveText.includes("<action>answer</action>"));
  assert.ok(answerDirectiveText.includes("<output_mode>final_text</output_mode>"));
  assert.ok(answerDirectiveText.includes("<visible_output_contract>"));
  assert.ok(answerDirectiveText.includes("<start>answer_body</start>"));
  assert.ok(answerDirectiveText.includes("<name>first_sentence</name>"));
  assert.ok(!answerDirectiveText.includes("<tool_protocol>"));
  assert.ok(!answerDirectiveText.includes("<tools>"));
  assert.ok(!answerDirectiveText.includes("一旦决定调用工具"));
  assert.ok(!answerDirectiveText.includes("<senera_action_directive>"));

  console.log("Action planner branch payload verification passed.");
}
