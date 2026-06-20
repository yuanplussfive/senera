import assert from "node:assert/strict";
import { AgentActionPlanner } from "../Source/AgentSystem/AgentActionPlanner.js";
import { AgentDefaults } from "../Source/AgentSystem/AgentDefaults.js";
import type { AgentToolCatalogItem } from "../Source/AgentSystem/AgentToolCatalogProjector.js";
import type {
  ResolvedAgentActionPlannerConfig,
  ResolvedAgentModelProviderConfig,
} from "../Source/AgentSystem/Types.js";
import { createActionPlanInputFixture } from "./ActionPlannerFixture.js";

const provider: ResolvedAgentModelProviderConfig = {
  Id: "main",
  Kind: "OpenAICompatible",
  Endpoint: "Responses",
  BaseUrl: "https://main.test/v1",
  ApiKey: "main-key",
  ApiVersion: "2023-06-01",
  Model: "main-model",
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
  Evidence: AgentDefaults.ActionPlanner.Evidence,
  Client: {
    Provider: "openai-responses",
    BaseUrl: "https://main.test/v1",
    ApiKey: "main-key",
    Model: "main-model",
    Temperature: 0.1,
    MaxTokens: -1,
  },
  TaskFrameClient: {
    Provider: "openai-responses",
    BaseUrl: "https://planner.test/v1",
    ApiKey: "planner-key",
    Model: "planner-model",
    Temperature: 0.1,
    MaxTokens: 4096,
  },
  EvidenceClient: {
    Provider: "openai-generic",
    BaseUrl: "https://evidence.test/v1",
    ApiKey: "evidence-key",
    Model: "evidence-model",
    Temperature: 0,
    MaxTokens: 2048,
  },
};

const catalogTool: AgentToolCatalogItem = {
  name: "EvidenceTool",
  title: "Evidence Tool",
  summary: "Provides verified evidence.",
  rootKind: "System",
  capabilities: [],
  tags: [],
  useCases: [],
  examples: [],
  avoid: [],
  permissions: [],
  evidenceCapabilities: [{
    produces: "workspace observation",
    quality: "observed",
    satisfies: ["workspace fact"],
    kinds: ["workspace_observation"],
    capabilityIds: [],
  }],
};

void main();

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const requests: Array<{
    url: string;
    body: Record<string, unknown>;
  }> = [];

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push({ url, body });

    if (url === "https://planner.test/v1/responses") {
      return new Response(sseEvent({
        type: "response.output_text.delta",
        delta: JSON.stringify(taskFrameResponse()),
      }), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }

    if (url === "https://evidence.test/v1/chat/completions") {
      return new Response(sseEvent({
        choices: [{
          delta: {
            content: JSON.stringify(evidenceVerificationResponse()),
          },
        }],
      }), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }

    throw new Error(`unexpected planner request: ${url}`);
  };

  try {
    const planner = new AgentActionPlanner(config, provider, {
      list: () => [catalogTool],
    });
    const fixture = createActionPlanInputFixture("verify existing evidence");
    const result = await planner.plan({
      requestId: "verify-split-planner-clients",
      input: {
        ...fixture,
        evidenceState: [{
          evidenceRef: "EV1",
          kind: "workspace_observation",
          toolName: "EvidenceTool",
          artifactUri: "senera://artifact/art_111111111111111111111111",
          locator: "workspace",
          display: "workspace fact is present",
          label: "workspace fact",
          facts: [{ name: "fact", value: "present" }],
          artifactRefs: ["projection"],
        }],
        compactToolCatalog: [{
          name: "EvidenceTool",
          title: "Evidence Tool",
          summary: "Provides verified evidence.",
          capabilities: [],
          evidence: ["workspace observation"],
          effects: [],
          outputs: [],
          permissions: [],
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
    assert.equal(result.kind === "planned" ? result.selectedAction : undefined, "answer");
    assert.deepEqual(requests.map((request) => request.url), [
      "https://planner.test/v1/responses",
      "https://evidence.test/v1/chat/completions",
    ]);
    assert.equal(requests[0]?.body.model, "planner-model");
    assert.equal(requests[1]?.body.model, "evidence-model");
    assert.equal((requests[0]?.body as { max_output_tokens?: number }).max_output_tokens, 4096);
    assert.equal((requests[1]?.body as { max_tokens?: number }).max_tokens, 2048);

    console.log("Action planner split clients verification passed.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function taskFrameResponse() {
  return {
    taskType: "evidence verification",
    answerGoal: "Answer after verifying existing evidence.",
    intentTags: ["verification"],
    targetRefs: [{
      kind: "workspace",
      value: "workspace",
      status: "observed",
    }],
    candidateTools: [{
      name: "EvidenceTool",
      purpose: "Provide workspace observation evidence.",
      supports: ["workspace observation"],
    }],
    discoveryQueries: [],
    requiredEffects: [],
    requiredEvidence: [{
      id: "workspace-fact",
      need: "workspace fact",
      minimum: 1,
      reason: "The final answer needs verified workspace evidence.",
    }],
    userInputNeeds: [],
    nextStepPurpose: "Verify the existing evidence.",
    completionCriteria: ["Workspace fact evidence is satisfied."],
    notes: [],
  };
}

function evidenceVerificationResponse() {
  return {
    ready: true,
    requirements: [{
      requirementId: "workspace-fact",
      need: "workspace fact",
      status: "Satisfied",
      evidenceRefs: ["EV1"],
      artifactUris: ["senera://artifact/art_111111111111111111111111"],
      reason: "EV1 directly supports the workspace fact.",
      missingFacts: [],
      unsupportedClaims: [],
    }],
    summary: "Existing evidence satisfies the task.",
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
