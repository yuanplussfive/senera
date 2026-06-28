import assert from "node:assert/strict";
import path from "node:path";
import { AgentActionPlannerContextBuilder } from "../Source/AgentSystem/ActionPlanner/AgentActionPlannerContext.js";
import { EmptyActionPlannerLedger } from "../Source/AgentSystem/ActionPlanner/AgentActionPlannerLedger.js";
import { loadVerificationConfig } from "./VerificationConfig.js";
import { AgentEvidenceBroker } from "../Source/AgentSystem/Evidence/AgentEvidenceBroker.js";
import { AgentPluginRegistry } from "../Source/AgentSystem/Plugin/AgentPluginRegistry.js";
import { AgentPluginScanner } from "../Source/AgentSystem/Plugin/AgentPluginScanner.js";
import { AgentSkillActivationService } from "../Source/AgentSystem/Skills/AgentSkillActivation.js";
import { AgentToolSearchRuntime } from "../Source/AgentSystem/ToolSearch/AgentToolSearchRuntime.js";
import {
  resolveModelProviderConfig,
  resolveToolLearningConfig,
  resolveToolSearchConfig,
} from "../Source/AgentSystem/AgentDefaults.js";
import { AgentToolCatalogProjector } from "../Source/AgentSystem/ToolRuntime/AgentToolCatalogProjector.js";
import { TaskEvidenceScope } from "../Source/AgentSystem/BamlClient/baml_client/types.js";
import {
  agentActionCapabilityNeeds,
  agentActionPreferredTools,
  agentActionToolSearchQueries,
} from "../Source/AgentSystem/ActionPlanner/AgentActionPlanner.js";

const workspaceRoot = process.cwd();

void main();

async function main(): Promise<void> {
const config = loadVerificationConfig(workspaceRoot);
const registry = new AgentPluginRegistry();
for (const plugin of new AgentPluginScanner(workspaceRoot, config).scan()) {
  registry.registerPlugin(plugin);
}

const skillActivation = new AgentSkillActivationService(registry);
const skills = skillActivation.activate({
  input: "看看我们的项目是干嘛的啊，有什么用",
});

assert.equal(skills.some((skill) => skill.name === "WorkspaceInvestigationSkill"), true);

const toolSearch = new AgentToolSearchRuntime(
  registry,
  resolveToolSearchConfig(config),
  resolveToolLearningConfig(config),
  workspaceRoot,
  resolveModelProviderConfig(config),
);
const loadedTools = toolSearch.resolvePlannedLoadedTools({
  input: "看看我们的项目是干嘛的啊，有什么用",
  loadedTools: "dynamic",
  currentLoadedTools: [],
  preferredTools: [],
  queries: [],
  needs: [],
  discover: false,
});

assert.notEqual(loadedTools, "all");

const input = new AgentActionPlannerContextBuilder().buildInput({
  requestId: "verify-workspace-question-evidence-planning",
  userMessage: "看看我们的项目是干嘛的啊，有什么用",
  currentStep: 1,
  dynamicTools: true,
  loadedToolNames: loadedTools,
  messages: [{
    role: "user",
    content: "看看我们的项目是干嘛的啊，有什么用",
  }],
  conversationEntries: [],
  ledger: EmptyActionPlannerLedger,
  toolCatalog: new AgentToolCatalogProjector(registry).list(),
  activeSkills: skills,
});

const decision = await new AgentEvidenceBroker().decide({
  input,
  taskFrame: {
    taskType: "workspace investigation",
    answerGoal: "说明项目用途",
    intentTags: ["workspace-investigation", "source-of-truth"],
    taskTags: ["workspace", "文件"],
    targetRefs: [{
      kind: "workspace",
      value: ".",
      status: "needs-inspection",
    }],
    candidateTools: [{
      name: "FastContextReadTool",
      purpose: "读取真实工作区文件内容。",
      supports: [
        "workspace read",
        "workspace source-of-truth",
        "project identity",
        "project purpose",
      ],
    }],
    discoveryQueries: ["workspace file read project purpose"],
    requiredEffects: [],
    requiredEvidence: [{
      id: "workspace-source-evidence",
      need: "workspace read source-of-truth evidence",
      scope: TaskEvidenceScope.CurrentRun,
      minimum: 1,
      reason: "需要读取真实工作区文件后才能说明项目用途。",
    }],
    userInputNeeds: [],
    nextStepPurpose: "读取能够证明项目用途的工作区文件。",
    completionCriteria: [
      "回答必须引用已读取的项目文件证据。",
    ],
    notes: [],
  },
});

assert.equal(decision.ready, false);
assert.equal(decision.recommendedTools.includes("FastContextReadTool"), true);
assert.equal(decision.recommendedTools.includes("FastContextWorkspaceMapTool"), false);

const loadedAfterContract = toolSearch.resolvePlannedLoadedTools({
  input: "看看我们的项目是干嘛的啊，有什么用",
  loadedTools: "dynamic",
  currentLoadedTools: loadedTools,
  preferredTools: agentActionPreferredTools(decision.action),
  queries: agentActionToolSearchQueries(decision.action),
  needs: agentActionCapabilityNeeds(decision.action),
  discover: decision.action.action === "discover_tools",
});

assert.notEqual(loadedAfterContract, "all");
assert.equal((loadedAfterContract as string[]).includes("FastContextReadTool"), true);

toolSearch.close();

console.log("Workspace question evidence planning verification passed.");
}
