import assert from "node:assert/strict";
import { AgentActionPlanner } from "../Source/AgentSystem/AgentActionPlanner.js";
import type { AgentToolCatalogItem } from "../Source/AgentSystem/AgentToolCatalogProjector.js";
import type { ResolvedAgentActionPlannerConfig, ResolvedAgentModelProviderConfig } from "../Source/AgentSystem/Types.js";
import { createActionPlanInputFixture } from "./ActionPlannerFixture.js";

const provider: ResolvedAgentModelProviderConfig = {
  Id: "test",
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

const config: ResolvedAgentActionPlannerConfig = {
  Enabled: true,
  MaxRepairAttempts: 0,
  Client: {
    Provider: "auto",
    BaseUrl: "https://example.test/v1",
    ApiKey: "test-key",
    Model: "test-model",
    Temperature: 0.1,
    MaxTokens: -1,
  },
};

const catalogTool: AgentToolCatalogItem = {
  name: "ApplyPatchTool",
  title: "Apply Patch Tool",
  summary: "Edit workspace files.",
  capabilities: [{
    id: "workspace.patch-edit",
    title: "Workspace patch edit",
    description: "Apply structured file edits.",
    facets: {
      Actions: ["edit", "patch"],
      Targets: ["workspace", "file"],
      Effects: ["write-workspace"],
    },
    risk: {
      sideEffect: "write-workspace",
      permission: "write",
    },
  }],
  tags: [],
  useCases: [],
  examples: [],
  avoid: [],
  permissions: ["filesystem:write:workspace"],
};

void main();

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const responses = [
    {
      action: "UseTools",
    },
    {
      action: "UseTools",
      answer: null,
      askUser: null,
      useTools: {
        preferredTools: ["ApplyPatchTool"],
        instruction: "Apply a structured patch only to the requested workspace file.",
      },
      discoverTools: null,
    },
  ];

  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(String(init?.body ?? ""));
    const response = responses.shift();
    assert.ok(response, "unexpected planner model call");
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
    const planner = new AgentActionPlanner(config, provider, {
      list: () => [catalogTool],
    });
    const result = await planner.plan({
      requestId: "verify-two-stage-payload",
      input: createActionPlanInputFixture("修改文件"),
    });
    assert.equal(result.kind, "planned");
    if (result.kind !== "planned") {
      throw new Error("Expected planned result.");
    }
    assert.equal(result.selectedAction, "use_tools");
    assert.equal(result.selectionRepaired, false);
    assert.equal(result.payloadRepaired, false);
    assert.equal(result.decision.action, "use_tools");
    if (result.decision.action !== "use_tools") {
      throw new Error("Expected use_tools decision.");
    }
    assert.equal(
      result.decision.useTools.instruction,
      "Apply a structured patch only to the requested workspace file.",
    );
    assert.equal(requests.length, 2, "planner should always perform action selection and payload construction");
    assert.match(requests[0] ?? "", /action selector/i);
    assert.match(requests[1] ?? "", /Build Senera's payload/);
    const payloadPrompt = readPlannerPromptFromHttpBody(requests[1] ?? "");
    assert.equal(payloadPrompt.directive.stage, "buildActionPayload");
    assert.equal(payloadPrompt.directive.selectedAction, "UseTools");
    assert.doesNotMatch(requests[1] ?? "", /Payload directive/);
    assert.doesNotMatch(requests[1] ?? "", /selectedAction=UseTools/);
    assert.doesNotMatch(requests[1] ?? "", /primaryContext|safetyContext|fallbackContext/);
    console.log("Action planner two-stage payload verification passed.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function readPlannerPromptFromHttpBody(body: string): {
  directive: {
    stage: string;
    selectedAction?: string;
  };
} {
  const payload = JSON.parse(body) as {
    messages?: Array<{
      role?: string;
      content?: string;
    }>;
  };
  const message = payload.messages?.find((entry) =>
    entry.role === "user" && typeof entry.content === "string" && entry.content.trim().startsWith("{")
  );
  assert.ok(message?.content, "planner HTTP body should contain JSON prompt content");
  return JSON.parse(message.content) as {
    directive: {
      stage: string;
      selectedAction?: string;
    };
  };
}

function sseEvent(value: Record<string, unknown>): string {
  return [
    `data: ${JSON.stringify(value)}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
}
