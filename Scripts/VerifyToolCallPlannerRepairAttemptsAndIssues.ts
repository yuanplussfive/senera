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

void main();

async function main(): Promise<void> {
  await verifyRepairAttempts();
  await verifyIssueSummary();
  console.log("Tool-call planner repair attempts and issue summary verification passed.");
}

async function verifyRepairAttempts(): Promise<void> {
  const fixture = createPlannerFixture(2);
  const requests: string[] = [];
  const responses = [
    invalidWorkspaceMapCall(),
    invalidWorkspaceMapCall(),
    validWorkspaceMapCall(),
  ];

  await withMockedFetch(requests, responses, async () => {
    const result = await fixture.planner.planToolCalls({
      input: fixture.input,
    });

    assert.equal(result.repaired, true);
    assert.equal(result.calls[0]?.name, "FastContextWorkspaceMapTool");
    assert.equal(result.calls[0]?.arguments.maxChildrenPerRoot, 24);
    assert.equal(requests.length, 3);
    assert.equal(readFinalPlannerInput(requests[1] ?? "").directive.stage, "repairToolCallPlan");
    assert.equal(readFinalPlannerInput(requests[2] ?? "").directive.stage, "repairToolCallPlan");
  });
}

async function verifyIssueSummary(): Promise<void> {
  const fixture = createPlannerFixture(1);
  const requests: string[] = [];
  const responses = [
    invalidWorkspaceMapCall(),
    invalidWorkspaceMapCall(),
  ];

  await withMockedFetch(requests, responses, async () => {
    await assert.rejects(
      () => fixture.planner.planToolCalls({
        input: fixture.input,
      }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /action_planner_invalid_decision/);
        assert.match(error.message, /maxChildrenPerRoot/);
        assert.match(error.message, /must be number/);
        return true;
      },
    );
    assert.equal(requests.length, 2);
  });
}

function createPlannerFixture(maxRepairAttempts: number): {
  planner: AgentActionPlanner;
  input: Parameters<AgentActionPlanner["planToolCalls"]>[0]["input"];
} {
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

  return {
    planner: new AgentActionPlanner(createActionPlannerConfigFixture({
      maxRepairAttempts,
      client: {
        Provider: "openai-generic",
        BaseUrl: "https://example.test/v1",
        ApiKey: "test-key",
        Model: "test-model",
        Temperature: 0.1,
        MaxTokens: -1,
      },
    }), provider, {}),
    input: {
      actionInput,
      rootCommand,
      toolContracts: promptContext.ToolCards,
    },
  };
}

async function withMockedFetch(
  requests: string[],
  responses: Array<Record<string, unknown>>,
  run: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
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
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function invalidWorkspaceMapCall(): Record<string, unknown> {
  return {
    calls: [{
      name: "FastContextWorkspaceMapTool",
      arguments: {
        maxChildrenPerRoot: "many",
      },
    }],
  };
}

function validWorkspaceMapCall(): Record<string, unknown> {
  return {
    calls: [{
      name: "FastContextWorkspaceMapTool",
      arguments: {
        maxChildrenPerRoot: 24,
      },
    }],
  };
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
