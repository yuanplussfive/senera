import assert from "node:assert/strict";
import path from "node:path";
import { AgentConfigLoader } from "../Source/AgentSystem/AgentConfigLoader.js";
import { AgentPluginRegistry } from "../Source/AgentSystem/AgentPluginRegistry.js";
import { AgentPluginScanner } from "../Source/AgentSystem/AgentPluginScanner.js";
import { AgentToolLearningRuntime } from "../Source/AgentSystem/AgentToolLearningRuntime.js";
import { AgentToolSearchMemory } from "../Source/AgentSystem/AgentToolSearchMemory.js";
import type { AgentToolLearningPromptInput } from "../Source/AgentSystem/AgentActionPlannerModelClient.js";
import { parseToolLearningResult } from "../Source/AgentSystem/AgentToolLearningSchema.js";
import type { ResolvedAgentModelProviderConfig, ResolvedAgentToolLearningConfig, ResolvedAgentToolSearchConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { ToolLearningResult } from "../Source/AgentSystem/BamlClient/baml_client/types.js";

void main();

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const config = AgentConfigLoader.load(path.join(workspaceRoot, "senera.config.json"));
  const registry = new AgentPluginRegistry();
  const memory = new AgentToolSearchMemory(memoryConfig(), workspaceRoot);
  const learning = new AgentToolLearningRuntime(
    registry,
    modelConfig(),
    learningConfig(),
    memory,
  );

  for (const plugin of new AgentPluginScanner(workspaceRoot, config).scan()) {
    registry.registerPlugin(plugin);
  }

  let observedInput: AgentToolLearningPromptInput | undefined;
  const fakeClient = {
    learnToolUse: async (input: AgentToolLearningPromptInput): Promise<ToolLearningResult> => {
      observedInput = input;
      return {
        records: [{
          toolName: "TavilySearchTool",
          tags: ["网页搜索", "最新消息"],
          sourceTerms: ["openai", "动态"],
          triggers: ["最近动态"],
          reason: "适合查询公开网页和最新消息。",
          confidence: 0.9,
        }],
      };
    },
    repairToolLearning: async (): Promise<ToolLearningResult> => {
      throw new Error("repair should not run");
    },
  };

  (learning as unknown as { client: typeof fakeClient }).client = fakeClient;
  await (learning as unknown as {
    learn(draft: Parameters<AgentToolLearningRuntime["enqueue"]>[0]): Promise<void>;
  }).learn({
    rawUserTurn: "OpenAI 最近有什么动态",
    standaloneRequest: "请介绍OpenAI最近的动态、重要事件或技术进展。",
    contextMode: "None",
    contextBasis: "",
    episode: {
      query: "OpenAI 最近动态",
      queryTokens: ["OpenAI", "最近动态"],
      plannerTags: ["网页搜索", "最新消息"],
      candidates: ["TavilySearchTool"],
      chosenTools: ["TavilySearchTool"],
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
    },
  });

  assert.deepEqual(observedInput?.toolTagCatalogByTool, [{
    toolName: "TavilySearchTool",
    tags: ["网页搜索", "最新消息", "外部资料", "新闻查询", "联网检索"],
  }]);
  assert.ok(observedInput?.candidateSourceTerms.includes("openai"));
  assert.ok(observedInput?.candidateSourceTerms.includes("动态"));
  assert.equal(observedInput?.candidateSourceTerms.includes("的"), false);
  assert.equal(observedInput?.candidateSourceTerms.includes("有"), false);
  assert.equal(memory.rank(["最近", "动态"], "verify-project")[0]?.toolName, "TavilySearchTool");
  assert.throws(
    () => parseToolLearningResult({
      records: [{
        toolName: "TavilySearchTool",
        tags: ["网页搜索"],
        sourceTerms: ["随便发明"],
        triggers: ["最近动态"],
        reason: "适合查询公开网页和最新消息。",
        confidence: 0.9,
      }],
    }, {
      selectedTools: ["TavilySearchTool"],
      candidateSourceTerms: observedInput?.candidateSourceTerms ?? [],
      toolTagCatalogByTool: new Map([["TavilySearchTool", new Set(["网页搜索"])]])
    }),
    /sourceTerms/,
  );

  memory.close();
  console.log("Tool learning runtime tag verification passed.");
}

function memoryConfig(): ResolvedAgentToolSearchConfig {
  return {
    Embedding: {
      Enabled: false,
      Model: "",
      Dimensions: -1,
      BatchSize: 1,
      InputMaxChars: 1,
      ScoreThreshold: 0,
    },
    Memory: {
      Kind: "memory",
      DatabasePath: "",
      MaxEpisodes: 100,
      HalfLifeDays: 30,
    },
    Ranking: {
      RrfK: 60,
      MmrLambda: 0.72,
      MmrCandidateScoreRatio: 0.92,
      MinScore: 0,
    },
    Rerank: {
      Enabled: false,
      CandidateLimit: 0,
      ScoreScale: 1,
      FeatureWeights: {},
    },
  };
}

function learningConfig(): ResolvedAgentToolLearningConfig {
  return {
    Enabled: true,
    MaxRepairAttempts: 1,
    Patterns: {
      MinSupport: 2,
      MaxPromptPatterns: 2,
    },
    Client: {
      Provider: "openai-generic",
      BaseUrl: "https://learning.test/v1",
      ApiKey: "test-key",
      Model: "test-model",
      Temperature: 0.1,
      MaxTokens: 1024,
    },
  };
}

function modelConfig(): ResolvedAgentModelProviderConfig {
  return {
    Id: "test-model-provider",
    ProviderId: "test-model-provider",
    Kind: "OpenAICompatible",
    Endpoint: "ChatCompletions",
    BaseUrl: "https://model.test/v1",
    ApiKey: "test-key",
    ApiVersion: "",
    Model: "test-model",
    Temperature: 0.1,
    MaxOutputTokens: 1024,
    Stream: false,
    TimeoutMs: 1000,
    FirstTokenTimeoutMs: 1000,
    MaxRequestMs: 1000,
    MaxNetworkRetries: 0,
    Headers: {},
  };
}
