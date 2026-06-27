import assert from "node:assert/strict";
import path from "node:path";
import { loadVerificationConfig } from "./VerificationConfig.js";
import { AgentPluginRegistry } from "../Source/AgentSystem/AgentPluginRegistry.js";
import { AgentPluginScanner } from "../Source/AgentSystem/AgentPluginScanner.js";
import { AgentPromptContextBuilder } from "../Source/AgentSystem/AgentPromptContextBuilder.js";
import { AgentPromptRenderer } from "../Source/AgentSystem/AgentPromptRenderer.js";
import type { AgentActionDecision } from "../Source/AgentSystem/AgentActionPlanner.js";
import { AgentSkillActivationService } from "../Source/AgentSystem/AgentSkillActivation.js";
import { AgentWorkflowSelector } from "../Source/AgentSystem/AgentWorkflowSelector.js";

void main();

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const config = loadVerificationConfig(workspaceRoot);
  const registry = new AgentPluginRegistry();
  for (const plugin of new AgentPluginScanner(workspaceRoot, config).scan()) {
    registry.registerPlugin(plugin);
  }

  assert.ok(registry.getSkill("WorkspaceInvestigationSkill"));
  assert.ok(registry.getSkill("MemoryFormationSkill"));

  const promptContextBuilder = new AgentPromptContextBuilder(registry, config);
  const skillActivation = new AgentSkillActivationService(registry);
  const renderer = new AgentPromptRenderer();
  const template = registry.getTemplate("BaseSystemPrompt");
  assert.ok(template, "BaseSystemPrompt template should be registered");

  const investigationPrompt = await renderPrompt({
    promptContextBuilder,
    registry,
    renderer,
    templatePath: template.path,
    skillActivation,
    decision: {
      action: "use_tools",
      useTools: {
        preferredTools: ["FastContextHybridSearchTool"],
        instruction: "调查工作区检索逻辑，先搜索再读取候选文件。",
        needs: [],
      },
    },
    loadedToolNames: [
      "FastContextHybridSearchTool",
      "FastContextSearchTool",
      "FastContextReadTool",
    ],
    skillQuery: "目前检索功能是怎么写的，像 codex 那样先搜索、读候选、再搜索。",
  });
  assert.match(investigationPrompt, /<workflow_skills>/);
  assert.match(investigationPrompt, /WorkspaceInvestigationSkill/);
  assert.doesNotMatch(investigationPrompt, /MemoryFormationSkill/);
  assert.match(investigationPrompt, /<workflow_recommended_tools>/);
  assert.match(investigationPrompt, /<workflow_recommendations>/);
  assert.match(investigationPrompt, /<recommended_agents>/);
  assert.match(investigationPrompt, /WorkspaceExplorer/);
  assert.match(investigationPrompt, /WorkspaceInvestigationWorkflow/);
  assert.match(investigationPrompt, /搜索结果只算候选/);

  const memoryPrompt = await renderPrompt({
    promptContextBuilder,
    registry,
    renderer,
    templatePath: template.path,
    skillActivation,
    decision: {
      action: "answer",
    },
    loadedToolNames: ["ToolSearchTool"],
    skillQuery: "长期记忆、用户画像、偏好和知识网络应该怎么形成？",
  });
  assert.match(memoryPrompt, /MemoryFormationSkill/);
  assert.doesNotMatch(memoryPrompt, /WorkspaceInvestigationSkill/);
  assert.match(memoryPrompt, /候选记忆/);
  assert.doesNotMatch(memoryPrompt, /<tool_protocol>/);
  assert.doesNotMatch(memoryPrompt, /<workflow_recommended_tools>/);

  const plainPrompt = await renderPrompt({
    promptContextBuilder,
    registry,
    renderer,
    templatePath: template.path,
    skillActivation,
    decision: {
      action: "answer",
    },
    loadedToolNames: ["ToolSearchTool"],
    skillQuery: "你好",
  });
  assert.doesNotMatch(plainPrompt, /<workflow_skills>/);

  console.log("Workflow skills verification passed.");
}

async function renderPrompt(options: {
  promptContextBuilder: AgentPromptContextBuilder;
  registry: AgentPluginRegistry;
  renderer: AgentPromptRenderer;
  templatePath: string;
  skillActivation: AgentSkillActivationService;
  decision: AgentActionDecision;
  loadedToolNames: "all" | string[];
  skillQuery: string;
}): Promise<string> {
  const activeSkills = options.skillActivation.activate({
    input: options.skillQuery,
    decision: options.decision,
  });
  const workflowRecommendedTools = options.decision.action === "answer"
    ? []
    : options.skillActivation.recommendedToolNames(activeSkills);
  const workflowRecommendations = options.decision.action === "answer"
    ? []
    : new AgentWorkflowSelector(options.registry).select({
      input: options.skillQuery,
      activeSkills,
    }).map((result) => ({
      name: result.workflow.name,
      title: result.workflow.title,
      description: result.workflow.description,
      sources: result.sources,
      matchedSkills: result.matchedSkills,
      matchedAgents: result.matchedAgents,
      matchedTerms: result.matchedTerms,
    }));
  const rootCommand = options.promptContextBuilder.buildRootCommand({
    decision: options.decision,
    loadedToolNames: options.loadedToolNames,
    workflowRecommendedTools,
    workflowRecommendations,
  });

  return options.renderer.renderFile(options.templatePath, {
    ...options.promptContextBuilder.buildBaseContext({
      loadedToolNames: options.loadedToolNames,
      rootCommand,
      skillQuery: options.skillQuery,
      activeSkills,
    }),
  });
}
