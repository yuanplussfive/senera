import assert from "node:assert/strict";
import type { ActionPlanInput, TaskFrame } from "../Source/AgentSystem/BamlClient/baml_client/types.js";
import {
  TaskEvidenceScope,
  ToolCallStatus,
} from "../Source/AgentSystem/BamlClient/baml_client/types.js";
import { AgentEvidenceBroker } from "../Source/AgentSystem/Evidence/AgentEvidenceBroker.js";

const taskFrame: TaskFrame = {
  taskType: "workspace investigation",
  answerGoal: "说明项目用途",
  intentTags: ["workspace-investigation"],
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
    ],
  }],
  discoveryQueries: ["workspace file read project purpose"],
  requiredEffects: [],
  requiredEvidence: [{
    id: "workspace-source-evidence",
    need: "workspace read source-of-truth evidence",
    scope: TaskEvidenceScope.CurrentRun,
    minimum: 1,
    reason: "最终回答需要真实文件读取证据。",
  }],
  userInputNeeds: [],
  nextStepPurpose: "读取项目说明或配置文件。",
  completionCriteria: [
    "回答必须基于读取到的文件。",
  ],
  notes: [],
};

const input: ActionPlanInput = {
  currentUserTurn: {
    content: "看看我们的项目是干嘛的啊，有什么用",
  },
  runState: {
    currentStep: 4,
    dynamicTools: true,
    loadedTools: ["FastContextReadTool"],
    progress: {
      totalToolCalls: 1,
      totalEvidence: 0,
      lastNewEvidenceStep: 0,
      repeatedCallCount: 0,
      stalled: true,
    },
    warnings: [],
    calls: [{
      step: 2,
      toolName: "FastContextReadTool",
      status: ToolCallStatus.Success,
      artifactUri: "senera://artifact/art_missing",
      evidenceUris: [],
      resultKind: "missing_path",
      argumentsPreview: "{\"path\":\"Source/package.json\"}",
      error: "",
    }],
  },
  timeline: [{
    index: 0,
    role: "user",
    kind: "user_message",
    content: "看看我们的项目是干嘛的啊，有什么用",
    evidenceUris: [],
    artifactUris: [],
  }],
  evidenceMemory: [],
  evidenceState: [],
  plannerJournal: [],
  toolTagCatalog: ["workspace", "文件"],
  compactToolCatalog: [],
  toolCatalog: [{
    name: "FastContextReadTool",
    title: "文件读取",
    summary: "读取工作区文件。",
    capabilities: [{
      id: "workspace.file-read",
      title: "Workspace file read",
      description: "Read workspace files and directories.",
      facets: {
        Actions: ["read"],
        Targets: ["workspace", "file"],
        Inputs: ["path"],
        Outputs: ["file-content"],
        Evidence: ["workspace-read"],
        Effects: ["read-only"],
      },
    }],
    tags: [],
    useCases: [],
    examples: [],
    avoid: [],
    permissions: [],
    evidenceCapabilities: [{
      produces: "workspace read",
      quality: "observed",
      satisfies: [
        "workspace source-of-truth",
        "workspace investigation",
      ],
      kinds: ["workspace_read"],
      capabilityIds: ["workspace.file-read"],
    }],
    loaded: true,
  }],
  activeSkills: [],
};

void main();

async function main(): Promise<void> {
const decision = await new AgentEvidenceBroker().decide({
  input,
  taskFrame,
});

assert.equal(decision.ready, false);
assert.equal(decision.action.action, "use_tools");
assert.equal(decision.missingNeeds[0]?.status, "stalled");
assert.equal(decision.progress.stalled, true);
assert.equal(decision.progress.nonEvidenceCalls.length, 1);
assert.equal(decision.progress.nonEvidenceCalls[0]?.resultKind, "missing_path");
assert.equal(decision.requirementStates[0]?.blockers.some((entry) =>
  entry.includes("FastContextReadTool produced no verified evidence")), true);
assert.equal(
  decision.action.action === "use_tools"
    && decision.action.useTools.instruction.includes("Source/package.json"),
  true,
);

console.log("Completion gate progress signal verification passed.");
}
