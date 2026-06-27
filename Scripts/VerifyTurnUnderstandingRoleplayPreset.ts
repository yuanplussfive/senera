import assert from "node:assert/strict";
import { b as baml } from "../Source/AgentSystem/BamlClient/baml_client/index.js";
import {
  buildActionPlannerPromptJson,
} from "../Source/AgentSystem/AgentActionPlannerPromptJson.js";
import {
  projectActionPlannerBamlRequestBody,
} from "../Source/AgentSystem/AgentActionPlannerPromptProjector.js";
import {
  createActionPlannerBamlClient,
} from "../Source/AgentSystem/AgentActionPlannerBamlClient.js";
import { createActionPlanInputFixture } from "./ActionPlannerFixture.js";
import type { ResolvedAgentModelProviderConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

void main();

async function main(): Promise<void> {
  const input = createActionPlanInputFixture("你老家的天气怎么样？");
  input.turnUnderstanding = undefined;
  input.roleplayPreset = {
    enabled: true,
    activePresetName: "role.md",
    documents: [{
      name: "role.md",
      format: "markdown",
      title: "角色",
      updatedAt: "2026-06-24T00:00:00.000Z",
      content: "角色老家是成都。",
    }],
  };

  const client = createActionPlannerBamlClient(providerFixture(), {
    Provider: "openai-generic",
    BaseUrl: "https://example.invalid/v1",
    ApiKey: "test",
    Model: "prompt-builder",
    Temperature: 0,
    MaxTokens: -1,
  });

  const understandRequest = await baml.request.UnderstandUserTurn(
    buildActionPlannerPromptJson(input, {
      stage: "understandUserTurn",
    }),
    {
      clientRegistry: client.registry,
    },
  );
  const understandPrompt = projectActionPlannerBamlRequestBody(
    understandRequest.body.json() as Record<string, unknown>,
  );
  const understandFinal = JSON.parse(understandPrompt.messages.at(-1)?.content ?? "{}") as {
    plannerInput?: {
      roleplayPreset?: {
        documents?: Array<{
          content?: string;
        }>;
      };
    };
  };
  assert.equal(
    understandFinal.plannerInput?.roleplayPreset?.documents?.[0]?.content,
    "角色老家是成都。",
  );

  const taskFrameRequest = await baml.request.BuildTaskFrame(
    buildActionPlannerPromptJson(input, {
      stage: "buildTaskFrame",
    }),
    {
      clientRegistry: client.registry,
    },
  );
  const taskFramePrompt = projectActionPlannerBamlRequestBody(
    taskFrameRequest.body.json() as Record<string, unknown>,
  );
  const taskFrameFinal = JSON.parse(taskFramePrompt.messages.at(-1)?.content ?? "{}") as {
    plannerInput?: {
      roleplayPreset?: unknown;
    };
  };
  assert.equal(taskFrameFinal.plannerInput?.roleplayPreset, undefined);

  console.log("Turn understanding roleplay preset verification passed.");
}

function providerFixture(): ResolvedAgentModelProviderConfig {
  return {
    Id: "test",
  ProviderId: "test",
  Kind: "OpenAICompatible",
    Endpoint: "ChatCompletions",
    BaseUrl: "https://example.invalid/v1",
    ApiKey: "test",
    ApiVersion: "2023-06-01",
    Model: "prompt-builder",
    Temperature: 0,
    MaxOutputTokens: -1,
    Stream: false,
    TimeoutMs: 1000,
    FirstTokenTimeoutMs: -1,
    MaxRequestMs: -1,
    MaxNetworkRetries: 0,
    Headers: {},
  };
}
