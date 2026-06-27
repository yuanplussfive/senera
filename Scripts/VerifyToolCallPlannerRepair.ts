import assert from "node:assert/strict";
import path from "node:path";
import { AgentActionPlanner } from "../Source/AgentSystem/AgentActionPlanner.js";
import { loadVerificationConfig } from "./VerificationConfig.js";
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

const config = createActionPlannerConfigFixture({
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
  const systemConfig = loadVerificationConfig(workspaceRoot);
  const registry = new AgentPluginRegistry();
  for (const plugin of new AgentPluginScanner(workspaceRoot, systemConfig).scan()) {
    registry.registerPlugin(plugin);
  }
  const promptContextBuilder = new AgentPromptContextBuilder(registry, systemConfig);
  const rootCommand = promptContextBuilder.buildRootCommand({
    decision: {
      action: "use_tools",
      useTools: {
        preferredTools: ["FastContextWorkspaceMapTool"],
        instruction: "查看项目结构",
        needs: [],
      },
    },
    loadedToolNames: ["FastContextWorkspaceMapTool"],
  });
  const promptContext = promptContextBuilder.buildBaseContext({
    loadedToolNames: ["FastContextWorkspaceMapTool"],
    rootCommand,
    skillQuery: "查看项目结构",
  });
  const input = createActionPlanInputFixture("查看项目结构");
  input.runState.loadedTools = ["FastContextWorkspaceMapTool"];

  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const responses = [
    {
      calls: [{
        name: "MissingTool",
        arguments: {
          maxChildrenPerRoot: "many",
        },
      }],
    },
    {
      calls: [{
        name: "FastContextWorkspaceMapTool",
        arguments: {
          maxChildrenPerRoot: 30,
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
    const result = await new AgentActionPlanner(config, provider, {}).planToolCalls({
      input: {
        actionInput: input,
        rootCommand,
        toolContracts: promptContext.ToolCards,
      },
    });

    assert.equal(result.repaired, true);
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0]?.name, "FastContextWorkspaceMapTool");
    assert.equal(result.calls[0]?.arguments.maxChildrenPerRoot, 30);
    assert.equal(requests.length, 2);

    const first = readFinalPlannerInput(requests[0] ?? "");
    assert.equal(first.directive.stage, "planToolCalls");
    assert.equal(first.rootCommand.outputMode, "tool_call_xml");
    assert.deepEqual(first.allowedTools, ["FastContextWorkspaceMapTool"]);
    assert.equal(first.toolContracts[0]?.name, "FastContextWorkspaceMapTool");
    assert.equal(JSON.stringify(first).includes("documentationXml"), false);

    const repair = readFinalPlannerInput(requests[1] ?? "");
    assert.equal(repair.directive.stage, "repairToolCallPlan");
    assert.equal(repair.directive.invalidPlan.includes("MissingTool"), true);
    assert.equal(repair.directive.issues.some((issue) => issue.includes("allowedTools")), true);

    console.log("Tool-call planner repair verification passed.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function readFinalPlannerInput(body: string): {
  directive: {
    stage: string;
    invalidPlan: string;
    issues: string[];
  };
  rootCommand: {
    outputMode: string;
  };
  allowedTools: string[];
  toolContracts: Array<{
    name: string;
  }>;
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
      rootCommand: {
        outputMode: string;
      };
      allowedTools: string[];
      toolContracts: Array<{
        name: string;
      }>;
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
