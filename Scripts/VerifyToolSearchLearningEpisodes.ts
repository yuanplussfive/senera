import assert from "node:assert/strict";
import { AgentToolSearchMemory } from "../Source/AgentSystem/AgentToolSearchMemory.js";
import { AgentToolSearchUsageMemory } from "../Source/AgentSystem/AgentToolSearchUsageMemory.js";
import type { AgentToolLearningSink } from "../Source/AgentSystem/AgentToolSearchUsageMemory.js";
import type { ResolvedAgentToolSearchConfig, ResolvedAgentToolLearningConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { ExecutedToolCallResult } from "../Source/AgentSystem/Types/ToolRuntimeTypes.js";

const config = {
  Memory: {
    Kind: "memory",
    DatabasePath: "",
    MaxEpisodes: 100,
    HalfLifeDays: 30,
  },
} as ResolvedAgentToolSearchConfig;

const memory = new AgentToolSearchMemory(config, process.cwd());
const learningConfig: ResolvedAgentToolLearningConfig = {
  Enabled: true,
  MaxRepairAttempts: 1,
  Patterns: {
    MinSupport: 2,
    MaxPromptPatterns: 2,
  },
  Client: {
    Provider: "openai-generic",
    BaseUrl: "https://learning.test/v1",
    ApiKey: "learning-key",
    Model: "learning-model",
    Temperature: 0.1,
    MaxTokens: 2048,
  },
};
const learningSink: AgentToolLearningSink = {
  enqueue: (draft) => {
    memory.record({
      ...draft.episode,
      learnedKeywords: [{
        toolName: draft.episode.chosenTools[0] ?? "",
        value: draft.standaloneRequest,
        source: "toolLearning.trigger",
        weight: 0.9,
      }],
    });
  },
};
const usage = new AgentToolSearchUsageMemory(
  memory,
  "verify-project",
  learningConfig,
  learningSink,
);

usage.rememberSearch("request-1", {
  query: "项目主模型配置文件",
  queryTokens: ["项目", "主模型", "配置文件"],
  plannerTags: ["工作区", "配置文件"],
  candidates: ["FastContextScoutTool", "FastContextWorkspaceMapTool"],
  timestamp: Date.now(),
});

usage.recordToolUsage("request-1", [
  {
    callId: "call-1",
    name: "FastContextScoutTool",
    arguments: {
      query: "项目主模型配置文件",
    },
    process: {
      exitCode: 0,
      signal: null,
      stderr: "",
    },
    result: {
      ok: true,
    },
    artifact: {
      artifactId: "artifact-1",
      artifactUri: "senera://artifact/art_111111111111111111111111",
      artifactPath: "E:\\senera\\.senera\\artifacts\\artifact-1",
      relativePath: "artifact-1",
      manifestPath: "manifest.json",
      files: {},
      summary: "CTX1 project model config source",
      evidence: [
        {
          key: "workspace.context:Source/AgentSystem/AgentDefaults.ts",
          evidenceUri: "senera://evidence/ev_555555555555555555555555",
          kind: "workspace_scout_file",
          locator: "Source/AgentSystem/AgentDefaults.ts:1-80",
          display: "workspace context: Source/AgentSystem/AgentDefaults.ts",
          label: "AgentDefaults.ts",
          source: "scout",
          confidence: 0.88,
          slots: {},
          modelSlots: [],
          plannerMemory: {
            facts: [],
            artifactRefs: ["evidence"],
          },
          metadata: {},
        },
      ],
      delta: [],
    },
  } satisfies ExecutedToolCallResult,
]);

const ranked = memory.rank(["项目", "配置文件"], "verify-project");
assert.equal(ranked[0]?.toolName, "FastContextScoutTool");
assert.ok((ranked[0]?.rankScore ?? 0) > 0);
assert.ok((ranked[0]?.confidence ?? 0) > 0.5);
assert.equal(ranked[0]?.signals[0]?.term, "项目主模型配置文件");
assert.equal(ranked[0]?.signals[0]?.support, 0.9);

usage.rememberSearch("request-2", {
  query: "网络搜索最新资料",
  queryTokens: ["网络", "搜索", "资料"],
  plannerTags: ["搜索"],
  candidates: ["TavilySearchTool"],
  timestamp: Date.now(),
});

usage.recordToolUsage("request-2", [
  {
    callId: "call-2",
    name: "TavilySearchTool",
    arguments: {
      query: "最新资料",
    },
    process: {
      exitCode: 1,
      signal: null,
      stderr: "network unavailable",
    },
    result: {
      ok: false,
      error: "network unavailable",
    },
  } satisfies ExecutedToolCallResult,
]);

const failedRanked = memory.rank(["网络", "搜索"], "verify-project");
assert.equal(failedRanked.some((entry) => entry.toolName === "TavilySearchTool"), false);

memory.record({
  query: "请 的 有 什么",
  queryTokens: ["请", "的", "有", "什么"],
  plannerTags: ["闲聊"],
  candidates: ["NoisyTool"],
  chosenTools: ["NoisyTool"],
  learnedKeywords: [],
  outcome: "success",
  calls: [],
  finalScore: 1,
  finalOutcome: {
    toolExecutionSucceeded: true,
    producedEvidence: true,
    producedArtifact: false,
    changedWorkspace: false,
  },
  projectId: "verify-project",
  timestamp: Date.now(),
});
assert.equal(memory.rank(["请", "的"], "verify-project").some((entry) => entry.toolName === "NoisyTool"), false);

memory.record({
  query: "模型动态",
  queryTokens: ["模型", "动态"],
  plannerTags: [],
  candidates: ["LowWeightTool"],
  chosenTools: ["LowWeightTool"],
  learnedKeywords: [{
    toolName: "LowWeightTool",
    value: "模型动态",
    source: "toolLearning.sourceTerm",
    weight: 0.2,
  }],
  outcome: "success",
  calls: [],
  finalScore: 1,
  finalOutcome: {
    toolExecutionSucceeded: true,
    producedEvidence: true,
    producedArtifact: false,
    changedWorkspace: false,
  },
  projectId: "verify-project",
  timestamp: Date.now(),
});
memory.record({
  query: "模型动态",
  queryTokens: ["模型", "动态"],
  plannerTags: [],
  candidates: ["HighWeightTool"],
  chosenTools: ["HighWeightTool"],
  learnedKeywords: [{
    toolName: "HighWeightTool",
    value: "模型动态",
    source: "toolLearning.trigger",
    weight: 1,
  }],
  outcome: "success",
  calls: [],
  finalScore: 1,
  finalOutcome: {
    toolExecutionSucceeded: true,
    producedEvidence: true,
    producedArtifact: false,
    changedWorkspace: false,
  },
  projectId: "verify-project",
  timestamp: Date.now(),
});
const weightedRanked = memory.rank(["模型", "动态"], "verify-project");
assert.equal(weightedRanked.findIndex((entry) => entry.toolName === "HighWeightTool") <
  weightedRanked.findIndex((entry) => entry.toolName === "LowWeightTool"), true);

memory.record({
  query: "Claude 最新动态",
  queryTokens: ["claude", "最新", "动态"],
  plannerTags: [],
  candidates: ["TavilySearchTool"],
  chosenTools: ["TavilySearchTool"],
  learnedKeywords: [{
    toolName: "TavilySearchTool",
    value: "claude 最新动态",
    source: "toolLearning.trigger",
    weight: 0.9,
  }],
  outcome: "success",
  calls: [{
    toolName: "TavilySearchTool",
    argumentKeys: ["query"],
    evidenceKinds: ["web_result"],
    status: "success",
    evidenceUris: ["WEB1"],
    artifactUris: ["senera://artifact/art_222222222222222222222222"],
    hasArtifact: true,
    hasEvidence: true,
    hasWorkspaceChanges: false,
    errorCode: "",
    error: "",
    score: 1,
  }],
  finalScore: 1,
  finalOutcome: {
    toolExecutionSucceeded: true,
    producedEvidence: true,
    producedArtifact: true,
    changedWorkspace: false,
  },
  projectId: "verify-project",
  timestamp: Date.now(),
});
memory.record({
  query: "Anthropic 最新动态",
  queryTokens: ["anthropic", "最新", "动态"],
  plannerTags: [],
  candidates: ["TavilySearchTool"],
  chosenTools: ["TavilySearchTool"],
  learnedKeywords: [{
    toolName: "TavilySearchTool",
    value: "anthropic 最新动态",
    source: "toolLearning.trigger",
    weight: 0.9,
  }],
  outcome: "success",
  calls: [{
    toolName: "TavilySearchTool",
    argumentKeys: ["query"],
    evidenceKinds: ["web_result"],
    status: "success",
    evidenceUris: ["WEB2"],
    artifactUris: ["senera://artifact/art_333333333333333333333333"],
    hasArtifact: true,
    hasEvidence: true,
    hasWorkspaceChanges: false,
    errorCode: "",
    error: "",
    score: 1,
  }],
  finalScore: 1,
  finalOutcome: {
    toolExecutionSucceeded: true,
    producedEvidence: true,
    producedArtifact: true,
    changedWorkspace: false,
  },
  projectId: "verify-project",
  timestamp: Date.now(),
});
const patterns = memory.patterns({
  queryTokens: ["claude", "最新", "动态"],
  projectId: "verify-project",
  allowedTools: ["TavilySearchTool"],
  minSupport: 2,
  limit: 2,
});
assert.equal(patterns[0]?.toolName, "TavilySearchTool");
assert.equal(patterns[0]?.supportCount, 2);
assert.match(patterns[0]?.argumentGuidance ?? "", /query/);
assert.match(patterns[0]?.evidenceGoal ?? "", /web_result/);

memory.close();
console.log("Tool search learning episode verification passed.");
