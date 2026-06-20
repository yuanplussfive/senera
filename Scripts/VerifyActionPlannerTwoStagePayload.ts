import assert from "node:assert/strict";
import { AgentActionPlanner } from "../Source/AgentSystem/AgentActionPlanner.js";
import type { AgentToolCatalogItem } from "../Source/AgentSystem/AgentToolCatalogProjector.js";
import type { ResolvedAgentModelProviderConfig } from "../Source/AgentSystem/Types.js";
import {
  createActionPlannerConfigFixture,
  createActionPlanInputFixture,
} from "./ActionPlannerFixture.js";

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

const config = createActionPlannerConfigFixture({
  maxRepairAttempts: 0,
  client: {
    Provider: "openai-generic",
    BaseUrl: "https://example.test/v1",
    ApiKey: "test-key",
    Model: "test-model",
    Temperature: 0.1,
    MaxTokens: -1,
  },
});

const catalogTool: AgentToolCatalogItem = {
  name: "ApplyPatchTool",
  title: "Apply Patch Tool",
  summary: "Edit workspace files.",
  rootKind: "System",
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
  evidenceCapabilities: [{
    produces: "workspace patch target",
    quality: "observed",
    satisfies: ["workspace edit"],
    kinds: ["workspace_patch_target"],
    capabilityIds: ["workspace.patch-edit"],
  }],
};

void main();

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const responses = [
    {
      taskType: "workspace edit",
      answerGoal: "Apply a structured patch only to the requested workspace file.",
      intentTags: ["workspace-edit"],
      targetRefs: [{
        kind: "workspace-file",
        value: "latest requested file",
        status: "needs-edit",
      }],
      candidateTools: [{
        name: "ApplyPatchTool",
        purpose: "Apply the requested workspace edit.",
        supports: ["workspace patch target"],
      }],
      discoveryQueries: ["workspace patch apply requested file"],
      requiredEffects: [{
        id: "workspace-write-effect",
        effect: "write-workspace",
        target: "latest requested file",
        proof: "workspace patch target",
        reason: "The latest user requested a workspace file modification.",
      }],
      requiredEvidence: [{
        id: "workspace-edit-evidence",
        need: "workspace edit",
        minimum: 1,
        reason: "The latest user requested a workspace file modification.",
      }],
      userInputNeeds: [],
      nextStepPurpose: "Apply a structured workspace patch.",
      completionCriteria: ["Workspace patch target evidence is produced."],
      notes: [],
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
    const fixture = createActionPlanInputFixture("修改文件");
    const result = await planner.plan({
      requestId: "verify-two-stage-payload",
      input: {
        ...fixture,
        runState: {
          ...fixture.runState,
          loadedTools: ["ApplyPatchTool"],
        },
        compactToolCatalog: [{
          name: "ApplyPatchTool",
          title: "Apply Patch Tool",
          summary: "Edit workspace files.",
          capabilities: ["workspace.patch-edit", "Workspace patch edit", "Apply structured file edits."],
          evidence: ["workspace patch target"],
          effects: ["write-workspace"],
          outputs: [],
          permissions: ["filesystem:write:workspace"],
          loaded: true,
          rootKind: "System",
        }],
        toolCatalog: [{
          ...catalogTool,
          loaded: true,
        }],
      },
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
    assert.match(result.decision.useTools.instruction, /workspace edit/);
    assert.equal(requests.length, 1, "planner should build a task frame and let evidence broker choose action");
    const taskFramePrompt = readPlannerPromptFromHttpBody(requests[0] ?? "");
    assert.equal(taskFramePrompt.directive.stage, "buildTaskFrame");
    assert.equal("selectedAction" in taskFramePrompt.directive, false);
    assert.equal(Array.isArray(taskFramePrompt.context.compactToolCatalog), true);
    assert.equal(taskFramePrompt.context.compactToolCatalog[0]?.name, "ApplyPatchTool");
    console.log("Action planner task-frame payload verification passed.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function readPlannerPromptFromHttpBody(body: string): {
  context: {
    compactToolCatalog: Array<{
      name: string;
    }>;
  };
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
    context: {
      compactToolCatalog: Array<{
        name: string;
      }>;
    };
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
