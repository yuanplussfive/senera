import assert from "node:assert/strict";
import { buildToolCallPlannerPromptEnvelope } from "../Source/AgentSystem/AgentToolCallPlannerPromptJson.js";
import {
  TurnContextMode,
  type ActionPlanInput,
} from "../Source/AgentSystem/BamlClient/baml_client/types.js";

const actionInput = {
  currentUserTurn: {
    requestId: "request-1",
    content: "Claude 最新动态",
  },
  turnUnderstanding: {
    rawUserTurn: "Claude 最新动态",
    standaloneRequest: "查询 Claude 最新动态",
    contextMode: TurnContextMode.None,
    contextBasis: "",
    missingContext: "",
  },
  runState: {
    currentStep: 1,
    dynamicTools: true,
    loadedTools: ["TavilySearchTool"],
    progress: {
      totalToolCalls: 0,
      totalEvidence: 0,
      lastNewEvidenceStep: 0,
      repeatedCallCount: 0,
      stalled: false,
    },
    warnings: [],
    calls: [],
  },
  timeline: [],
  evidenceMemory: [],
  evidenceState: [],
  plannerJournal: [],
  toolTagCatalog: [],
  compactToolCatalog: [],
  toolCatalog: [],
  activeSkills: [],
} satisfies ActionPlanInput;

const envelope = buildToolCallPlannerPromptEnvelope({
  actionInput,
  rootCommand: {
    authority: "senera_runtime_root",
    action: "use_tools",
    outputMode: "tool_call_xml",
    toolAccess: "restricted",
    objective: "查询 Claude 最新动态",
    instruction: "查询 Claude 最新动态",
    allowedTools: ["TavilySearchTool"],
    forbiddenOutputs: [],
    preferredTools: ["TavilySearchTool"],
    workflowRecommendedTools: [],
    workflowRecommendations: [],
    toolSearchQueries: [],
    needs: [],
    taskContract: null,
    insufficiencyPolicy: "answer_with_available_context",
    includeDecisionProtocol: true,
    includeToolCatalog: true,
    visibleOutput: {
      audience: "",
      start: "",
      format: "",
      rules: [],
      repair: {
        instruction: "",
        rules: [],
      },
    },
  },
  toolContracts: [{
    name: "TavilySearchTool",
    description: "Search web pages.",
    whenToUse: "Use for public web search.",
    whenNotToUse: "",
    documentationXml: "",
    argumentsContract: {
      tsHintLines: [],
      xmlPreview: "",
      jsonSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
          },
        },
        required: ["query"],
      },
      properties: [{
        name: "query",
        displayName: "query",
        path: "/query",
        depth: 1,
        kind: "scalar",
        typeText: "string",
        required: true,
        comment: "Search query.",
        xmlHint: "",
        children: [],
        elements: [],
      }],
    },
  }],
  toolUsePatterns: [{
    toolName: "TavilySearchTool",
    triggerSummary: "相关触发词：claude、最新、动态",
    argumentGuidance: "优先按当前用户目标填写这些已成功使用过的参数：query。",
    evidenceGoal: "历史成功结果通常产生：web_result。",
    confidence: 1,
    supportCount: 2,
    successCount: 2,
    failureCount: 0,
    lastSeenAt: 1,
  }],
}, {
  stage: "planToolCalls",
});

assert.deepEqual(envelope.context.toolUsePatterns, [{
  toolName: "TavilySearchTool",
  triggerSummary: "相关触发词：claude、最新、动态",
  argumentGuidance: "优先按当前用户目标填写这些已成功使用过的参数：query。",
  evidenceGoal: "历史成功结果通常产生：web_result。",
  confidence: 1,
  supportCount: 2,
}]);

console.log("ToolCall planner use-pattern projection verification passed.");
