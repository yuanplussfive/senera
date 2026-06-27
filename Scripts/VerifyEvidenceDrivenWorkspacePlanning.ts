import assert from "node:assert/strict";
import type { ActionPlanInput } from "../Source/AgentSystem/BamlClient/baml_client/types.js";
import { TaskEvidenceScope } from "../Source/AgentSystem/BamlClient/baml_client/types.js";
import { AgentEvidenceBroker } from "../Source/AgentSystem/AgentEvidenceBroker.js";

const workspaceTaskFrame = {
  taskType: "workspace investigation",
  answerGoal: "说明当前项目是干嘛的，有什么用",
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
  discoveryQueries: ["workspace file read project identity purpose"],
  requiredEffects: [],
  requiredEvidence: [{
    id: "workspace-source-evidence",
    need: "workspace read source-of-truth evidence",
    scope: TaskEvidenceScope.CurrentRun,
    minimum: 1,
    reason: "项目地图和搜索候选只用于定位，最终回答需要读取到真实文件内容。",
  }],
  userInputNeeds: [],
  nextStepPurpose: "读取可证明项目身份和用途的工作区文件。",
  completionCriteria: [
    "回答必须基于已读取的工作区文件内容。",
  ],
  notes: [],
};

const toolCatalog: ActionPlanInput["toolCatalog"] = [
  {
    name: "FastContextHybridSearchTool",
    title: "工作区搜索",
    summary: "混合检索本地代码。",
    capabilities: [{
      id: "workspace.hybrid-search",
      title: "Workspace hybrid search",
      description: "Locate relevant source files.",
      facets: {
        Actions: ["search", "locate"],
        Targets: ["workspace", "source-code"],
        Inputs: ["query"],
        Outputs: ["match-list"],
        Evidence: ["workspace-search-match"],
        Effects: ["read-only"],
      },
    }],
    tags: [],
    useCases: [],
    examples: [],
    avoid: [],
    permissions: [],
    evidenceCapabilities: [{
      produces: "workspace candidate",
      quality: "candidate",
      satisfies: ["candidate location", "workspace candidate location"],
      kinds: ["workspace_search_match"],
      capabilityIds: ["workspace.hybrid-search"],
    }],
    loaded: true,
  },
  {
    name: "FastContextWorkspaceMapTool",
    title: "项目地图",
    summary: "查看工作区目录结构。",
    capabilities: [{
      id: "workspace.map",
      title: "Workspace map",
      description: "Inspect top-level workspace structure.",
      facets: {
        Actions: ["inspect", "map"],
        Targets: ["workspace", "directory-tree"],
        Inputs: ["workspace-root"],
        Outputs: ["directory-summary"],
        Evidence: ["workspace-map-path"],
        Effects: ["read-only"],
      },
    }],
    tags: [],
    useCases: [],
    examples: [],
    avoid: [],
    permissions: [],
    evidenceCapabilities: [{
      produces: "workspace map",
      quality: "observed",
      satisfies: [
        "project orientation",
        "project structure",
        "workspace orientation",
        "workspace investigation entrypoint",
      ],
      kinds: ["workspace_map_path", "workspace_recommended_root"],
      capabilityIds: ["workspace.map"],
    }],
    loaded: true,
  },
  {
    name: "FastContextReadTool",
    title: "文件读取",
    summary: "读取工作区文件。",
    capabilities: [{
      id: "workspace.file-read",
      title: "Workspace file read",
      description: "Read workspace files and directories.",
      facets: {
        Actions: ["read", "inspect"],
        Targets: ["workspace", "file", "directory"],
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
        "project identity",
        "project purpose",
        "workspace source-of-truth",
        "implementation detail",
        "source behavior",
        "workspace investigation",
      ],
      kinds: ["workspace_read"],
      capabilityIds: ["workspace.file-read"],
    }],
    loaded: true,
  },
];

const evidenceBroker = new AgentEvidenceBroker({
  verify: async ({ input, taskFrame }) => {
    const verifiedRefs = input.evidenceState
      .filter((entry) => entry.kind === "workspace_read")
      .map((entry) => entry.evidenceUri);
    return {
      ready: verifiedRefs.length > 0,
      summary: verifiedRefs.length > 0 ? "workspace read evidence verifies the claim" : "no source evidence",
      requirements: taskFrame.requiredEvidence.map((requirement) => ({
        requirementId: requirement.id,
        need: requirement.need,
        status: verifiedRefs.length > 0 ? "satisfied" : "missing",
        evidenceUris: verifiedRefs,
        artifactUris: input.evidenceState
          .filter((entry) => verifiedRefs.includes(entry.evidenceUri))
          .map((entry) => entry.artifactUri),
        reason: verifiedRefs.length > 0
          ? "A workspace read evidence card supports the required claim."
          : "Search and map evidence do not directly support the required claim.",
        missingFacts: verifiedRefs.length > 0 ? [] : ["workspace file content"],
        unsupportedClaims: [],
      })),
    };
  },
});

void main();

async function main(): Promise<void> {
const input = createInput({
  evidenceState: [createEvidenceState({
    evidenceUri: "S1",
    kind: "workspace_search_match",
    toolName: "FastContextHybridSearchTool",
    artifactUri: "senera-artifact://runs/search",
    locator: "Source/AgentSystem/AgentCompletionGate.ts:1",
    display: "workspace search match: AgentCompletionGate",
    label: "AgentCompletionGate.ts",
    source: "workspace search",
    facts: [
      { name: "path", value: "Source/AgentSystem/AgentCompletionGate.ts" },
      { name: "reason", value: "candidate location" },
    ],
  })],
});

await assertMissingReadEvidence(input, "search candidates are not final evidence");

const mapOnlyInput = createInput({
  evidenceState: [createEvidenceState({
    evidenceUri: "M1",
    kind: "workspace_map_path",
    toolName: "FastContextWorkspaceMapTool",
    artifactUri: "senera-artifact://runs/map",
    locator: ".",
    display: "workspace directory map",
    label: "workspace map",
    source: "workspace map",
    facts: [
      { name: "path", value: "." },
      { name: "purpose", value: "orientation" },
    ],
  })],
});

await assertMissingReadEvidence(mapOnlyInput, "workspace map is only orientation evidence");

const readInput = createInput({
  evidenceState: [createEvidenceState({
    evidenceUri: "R1",
    kind: "workspace_read",
    toolName: "FastContextReadTool",
    artifactUri: "senera-artifact://runs/read",
    locator: "package.json",
    display: "workspace file read: package.json",
    label: "package.json",
    source: "workspace read",
    facts: [
      { name: "path", value: "package.json" },
      { name: "kind", value: "file" },
    ],
  })],
});

const readyDecision = await evidenceBroker.decide({
  input: readInput,
  taskFrame: workspaceTaskFrame,
});

assert.equal(readyDecision.ready, true);
assert.equal(readyDecision.action.action, "answer");
assert.deepEqual(readyDecision.satisfiedNeeds.map((entry) => entry.need), [
  "workspace read source-of-truth evidence",
]);

console.log("Evidence-driven workspace planning verification passed.");
}

async function assertMissingReadEvidence(input: ActionPlanInput, message: string): Promise<void> {
  const decision = await evidenceBroker.decide({
    input,
    taskFrame: workspaceTaskFrame,
  });

  assert.equal(decision.ready, false, message);
  assert.equal(decision.action.action, "use_tools", message);
  assert.deepEqual(decision.missingNeeds.map((entry) => entry.need), [
    "workspace read source-of-truth evidence",
  ]);
  assert.equal(decision.recommendedTools.includes("FastContextReadTool"), true);
  assert.equal(decision.recommendedTools.includes("FastContextWorkspaceMapTool"), false);
}

function createInput(options: {
  evidenceState: ActionPlanInput["evidenceState"];
}): ActionPlanInput {
  return {
    currentUserTurn: {
      content: "看看我们的项目是干嘛的啊，有什么用",
    },
    runState: {
      currentStep: 1,
      dynamicTools: true,
      loadedTools: [
        "FastContextWorkspaceMapTool",
        "FastContextReadTool",
        "FastContextHybridSearchTool",
      ],
      progress: {
        totalToolCalls: options.evidenceState.length,
        totalEvidence: options.evidenceState.length,
        lastNewEvidenceStep: 1,
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
      content: "看看我们的项目是干嘛的啊，有什么用",
      evidenceUris: [],
      artifactUris: [],
    }],
    evidenceMemory: [],
    evidenceState: options.evidenceState,
    plannerJournal: [],
    toolTagCatalog: ["workspace", "文件"],
    compactToolCatalog: toolCatalog.map((tool) => ({
      name: tool.name,
      title: tool.title,
      summary: tool.summary,
      capabilities: tool.capabilities.map((capability) => capability.id),
      evidence: tool.evidenceCapabilities.flatMap((capability) => [
        capability.produces,
        ...capability.satisfies,
        ...capability.kinds,
      ]),
      effects: tool.capabilities.flatMap((capability) => capability.facets.Effects ?? []),
      outputs: tool.capabilities.flatMap((capability) => capability.facets.Outputs ?? []),
      permissions: tool.permissions,
      loaded: true,
      rootKind: "User",
    })),
    toolCatalog,
    activeSkills: [{
      name: "WorkspaceInvestigationSkill",
      title: "工作区调查",
      summary: "形成可验证的代码证据。",
      useCases: [],
      avoid: [],
      recommendedTools: [
        "FastContextWorkspaceMapTool",
        "FastContextReadTool",
      ],
      evidenceRequirements: [{
        need: "workspace read source-of-truth evidence",
        accepts: [
          "workspace read",
          "project identity",
          "project purpose",
          "implementation detail",
          "source behavior",
        ],
        minimumQuality: ["observed"],
        minimum: 1,
        purpose: "项目地图和搜索候选只用于定位，不满足最终回答。",
      }],
    }],
  };
}

function createEvidenceState(options: {
  evidenceUri: string;
  kind: string;
  toolName: string;
  artifactUri: string;
  locator: string;
  display: string;
  label: string;
  source: string;
  facts: ActionPlanInput["evidenceState"][number]["facts"];
}): ActionPlanInput["evidenceState"][number] {
  return {
    ...options,
    confidence: 0.8,
    artifactRefs: [options.artifactUri],
  };
}
