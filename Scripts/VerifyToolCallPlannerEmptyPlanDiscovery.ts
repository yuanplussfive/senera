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
  const loadedToolNames = ["FastContextWorkspaceMapTool"];
  const rootCommand = promptContextBuilder.buildRootCommand({
    decision: {
      action: "use_tools",
      useTools: {
        preferredTools: loadedToolNames,
        instruction: "查看项目结构。",
        needs: [],
      },
    },
    loadedToolNames,
  });
  const promptContext = promptContextBuilder.buildBaseContext({
    loadedToolNames,
    rootCommand,
    skillQuery: "查看项目结构",
  });
  const actionInput = createActionPlanInputFixture("查看项目结构");
  actionInput.runState.loadedTools = loadedToolNames;

  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const responses = [
    { calls: [] },
    { calls: [] },
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
    const outcome = await new AgentActionPlanner(plannerConfig, provider, {}).planToolCallOutcome({
      input: {
        actionInput,
        rootCommand,
        toolContracts: promptContext.ToolCards,
      },
    });

    assert.equal(outcome.kind, "needsDiscovery");
    assert.equal(outcome.kind === "needsDiscovery" ? outcome.repaired : undefined, true);
    assert.equal(outcome.kind === "needsDiscovery" ? outcome.queries.includes("查看项目结构") : false, true);
    assert.equal(
      outcome.kind === "needsDiscovery"
        ? outcome.issues.some((issue) => issue.includes("工具调用计划为空"))
        : false,
      true,
    );
    assert.equal(requests.length, 2);
    assert.equal(readFinalPlannerInput(requests[1] ?? "").directive.stage, "repairToolCallPlan");

    console.log("Tool-call planner empty-plan discovery escalation verification passed.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function readFinalPlannerInput(body: string): {
  directive: {
    stage: string;
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
