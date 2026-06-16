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
    },
  };
  const promptRenderer = new AgentPromptRenderer();
  const promptContext = new AgentPromptContextBuilder(registry, config).buildBaseContext({
    loadedToolNames: ["ToolSearchTool", "FastContextWorkspaceMapTool"],
    actionDirective: useTools,
  });
  const template = registry.getTemplate("ActionDirective");
  assert.ok(template, "ActionDirective template should be registered");
  const directiveText = await promptRenderer.renderFile(template.path, {
    ...promptContext,
  });
  assert.match(directiveText, /<action>use_tools<\/action>/);
  assert.match(directiveText, /<instruction>Inspect the workspace structure\.<\/instruction>/);
  assert.match(directiveText, /<tool>FastContextWorkspaceMapTool<\/tool>/);
  assert.doesNotMatch(directiveText, /<intent>/);
  assert.doesNotMatch(directiveText, /<confidence>/);
  assert.doesNotMatch(directiveText, /<required_capabilities>/);
  assert.doesNotMatch(directiveText, /<tags>/);

  console.log("Action planner branch payload verification passed.");
}
