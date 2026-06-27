import assert from "node:assert/strict";
import { AgentActionPlanner } from "../Source/AgentSystem/AgentActionPlanner.js";
import type { AgentToolCatalogItem } from "../Source/AgentSystem/AgentToolCatalogProjector.js";
import { TaskEvidenceScope } from "../Source/AgentSystem/BamlClient/baml_client/types.js";
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
    Temperature: 0,
    MaxTokens: -1,
  },
});

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
  const requests: Record<string, unknown>[] = [];
  const responses = [
    taskFrameResponse(),
    "This is not an EvidenceVerification object.",
    evidenceVerificationResponse(),
  ];

  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push(body);
    const response = responses.shift();
    assert.ok(response !== undefined, "unexpected model request");
    return new Response(sseEvent(response), {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
      },
    });
  };

  try {
    const fixture = createActionPlanInputFixture("verify existing evidence");
    const planner = new AgentActionPlanner(config, provider, {
      list: () => [catalogTool],
    });
    const result = await planner.plan({
      requestId: "verify-baml-structured-output-evidence-repair",
      input: {
        ...fixture,
        evidenceState: [{
          evidenceUri: "EV1",
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
    assert.equal(requests.length, 3);

    const repairPrompt = readPlannerInput(requests[2]);
    assert.equal(repairPrompt.directive.stage, "repairEvidenceVerification");
    assert.equal(
      String(repairPrompt.directive.invalidVerification).includes("not an EvidenceVerification"),
      true,
    );
    assert.equal(Array.isArray(repairPrompt.directive.issues), true);

    console.log("BAML structured output evidence repair verification passed.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function taskFrameResponse(): Record<string, unknown> {
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
      scope: TaskEvidenceScope.CurrentRun,
      minimum: 1,
      reason: "The final answer needs verified workspace evidence.",
    }],
    userInputNeeds: [],
    nextStepPurpose: "Verify the existing evidence.",
    completionCriteria: ["Workspace fact evidence is satisfied."],
    notes: [],
  };
}

function evidenceVerificationResponse(): Record<string, unknown> {
  return {
    ready: true,
    requirements: [{
      requirementId: "workspace-fact",
      need: "workspace fact",
      status: "Satisfied",
      evidenceUris: ["EV1"],
      artifactUris: ["senera://artifact/art_111111111111111111111111"],
      reason: "EV1 directly supports the workspace fact.",
      missingFacts: [],
      unsupportedClaims: [],
    }],
    summary: "Existing evidence satisfies the task.",
  };
}

function sseEvent(value: string | Record<string, unknown>): string {
  const content = typeof value === "string" ? value : JSON.stringify(value);
  return [
    `data: ${JSON.stringify({
      choices: [{
        delta: {
          content,
        },
      }],
    })}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
}

function readPlannerInput(body: Record<string, unknown>): {
  directive: {
    stage: string;
    invalidVerification?: string;
    issues?: unknown;
  };
} {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = messages.at(-1);
  assert.ok(last && typeof last === "object");
  const content = (last as { content?: unknown }).content;
  assert.equal(typeof content, "string");
  const parsed = JSON.parse(content as string) as {
    plannerInput: {
      directive: {
        stage: string;
        invalidVerification?: string;
        issues?: unknown;
      };
    };
  };
  return parsed.plannerInput;
}
