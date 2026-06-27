import assert from "node:assert/strict";
import path from "node:path";
import { AgentActionPlanner } from "../Source/AgentSystem/AgentActionPlanner.js";
import { AgentConfigLoader } from "../Source/AgentSystem/AgentConfigLoader.js";
import { AgentPluginRegistry } from "../Source/AgentSystem/AgentPluginRegistry.js";
import { AgentPluginScanner } from "../Source/AgentSystem/AgentPluginScanner.js";
import { AgentPromptContextBuilder } from "../Source/AgentSystem/AgentPromptContextBuilder.js";
import type { ResolvedAgentModelProviderConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import {
  createActionPlannerConfigFixture,
  createActionPlanInputFixture,
} from "./ActionPlannerFixture.js";

const provider: ResolvedAgentModelProviderConfig = {
  Id: "test",
  ProviderId: "test",
  Kind: "OpenAICompatible",
  Endpoint: "ChatCompletions",
  BaseUrl: "https://example.test/v1",
  ApiKey: "test-key",
  ApiVersion: "2023-06-01",
  Model: "test-model",
  Temperature: 0.2,
  MaxOutputTokens: -1,
  Stream: true,
  TimeoutMs: 1000,
  FirstTokenTimeoutMs: -1,
  MaxRequestMs: -1,
  MaxNetworkRetries: 0,
  Headers: {},
};

const plannerConfig = createActionPlannerConfigFixture({
  maxRepairAttempts: 1,
  client: {
    Provider: "openai-generic",
    BaseUrl: "https://example.test/v1",
    ApiKey: "test-key",
    Model: "test-model",
    Temperature: 0.1,
    MaxTokens: -1,
  },
});

void main();

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const systemConfig = AgentConfigLoader.load(path.join(workspaceRoot, "senera.config.json"));
  const registry = new AgentPluginRegistry();
  for (const plugin of new AgentPluginScanner(workspaceRoot, systemConfig).scan()) {
    registry.registerPlugin(plugin);
  }

  const promptContextBuilder = new AgentPromptContextBuilder(registry, systemConfig);
  const loadedToolNames = [
    "FastContextScoutTool",
    "FastContextHybridSearchTool",
  ];
  const rootCommand = promptContextBuilder.buildRootCommand({
    decision: {
      action: "use_tools",
      useTools: {
        preferredTools: loadedToolNames,
        instruction: "定位项目主模型配置文件。",
        needs: [],
      },
    },
    loadedToolNames,
  });
  const promptContext = promptContextBuilder.buildBaseContext({
    loadedToolNames,
    rootCommand,
    skillQuery: "项目主模型配置文件怎么写",
  });

  const scout = promptContext.ToolCards.find((tool) => tool.name === "FastContextScoutTool");
  const hybrid = promptContext.ToolCards.find((tool) => tool.name === "FastContextHybridSearchTool");
  assert.ok(scout?.argumentsContract, "Scout contract should be loaded.");
  assert.ok(hybrid?.argumentsContract, "Hybrid contract should be loaded.");
  assert.deepEqual(contractFieldNames(scout.argumentsContract), [
    "question",
    "hints",
    "roots",
    "exclude",
    "maxQueries",
    "maxResults",
    "maxFiles",
    "contextLines",
    "readLineWindow",
    "refreshIndex",
    "planningMode",
  ]);
  assert.deepEqual(contractFieldNames(hybrid.argumentsContract), [
    "query",
    "roots",
    "exclude",
    "maxResults",
    "contextLines",
    "regex",
    "caseSensitive",
    "refreshIndex",
  ]);

  const input = createActionPlanInputFixture("项目主模型配置文件怎么写？");
  input.runState.loadedTools = loadedToolNames;

  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const responses = [
    {
      calls: [{
        name: "FastContextHybridSearchTool",
        arguments: {
          query: {
            text: "项目主模型配置文件",
          },
          hints: {
            item: ["ModelProviders"],
          },
          maxFiles: 5,
        },
      }],
    },
    {
      calls: [{
        name: "FastContextScoutTool",
        arguments: {
          question: "项目主模型配置文件怎么写？",
          hints: {
            item: ["ModelProviders"],
          },
          maxFiles: 5,
        },
      }],
    },
  ];

  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(String(init?.body ?? ""));
    const response = responses.shift();
    assert.ok(response, "unexpected tool-call planner model call");
    return new Response(sseEvent({
      choices: [{
        delta: {
          content: JSON.stringify(response),
        },
      }],
    }), {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
      },
    });
  };

  try {
    const result = await new AgentActionPlanner(plannerConfig, provider, {}).planToolCalls({
      input: {
        actionInput: input,
        rootCommand,
        toolContracts: promptContext.ToolCards,
      },
    });

    assert.equal(result.repaired, true);
    assert.equal(result.calls[0]?.name, "FastContextScoutTool");
    assert.equal(result.calls[0]?.arguments.question, "项目主模型配置文件怎么写？");
    assert.equal(requests.length, 2);

    const repair = readFinalPlannerInput(requests[1] ?? "");
    assert.equal(repair.directive.stage, "repairToolCallPlan");
    assert.equal(
      repair.directive.issues.some((issue) =>
        issue.includes("hints") && issue.includes("additional properties")),
      true,
    );
    assert.equal(
      repair.directive.issues.some((issue) =>
        issue.includes("query") && issue.includes("must be string")),
      true,
    );

    console.log("Tool signature mapping and tool-plan contract validation verification passed.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function contractFieldNames(contract: {
  properties: Array<{
    name: string;
  }>;
}): string[] {
  return contract.properties.map((property) => property.name);
}

function readFinalPlannerInput(body: string): {
  directive: {
    stage: string;
    invalidPlan: string;
    issues: string[];
  };
} {
  const payload = JSON.parse(body) as {
    messages?: Array<{
      role?: string;
      content?: string;
    }>;
  };
  const message = payload.messages?.at(-1);
  assert.equal(message?.role, "user");
  assert.ok(message?.content);
  const parsed = JSON.parse(message.content) as {
    plannerInput: {
      directive: {
        stage: string;
        invalidPlan: string;
        issues: string[];
      };
    };
  };
  return parsed.plannerInput;
}

function sseEvent(value: Record<string, unknown>): string {
  return [
    `data: ${JSON.stringify(value)}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
}
