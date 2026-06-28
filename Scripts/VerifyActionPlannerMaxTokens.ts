import assert from "node:assert/strict";
import { createActionPlannerBamlClient } from "../Source/AgentSystem/ActionPlanner/AgentActionPlannerBamlClient.js";
import { buildActionPlannerPromptJson } from "../Source/AgentSystem/ActionPlanner/AgentActionPlannerPromptJson.js";
import { b as baml } from "../Source/AgentSystem/BamlClient/baml_client/index.js";
import type { ResolvedAgentModelProviderConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import {
  createActionPlanInputFixture,
} from "./ActionPlannerFixture.js";

const baseProvider: ResolvedAgentModelProviderConfig = {
  Id: "test",
  ProviderId: "test",
  Kind: "OpenAICompatible",
  Endpoint: "ChatCompletions",
  BaseUrl: "https://example.test/v1",
  ApiKey: "test-key",
  ApiVersion: "2023-06-01",
  Model: "test-model",
  Temperature: 0.2,
  MaxOutputTokens: 123,
  Stream: true,
  TimeoutMs: 1000,
  FirstTokenTimeoutMs: -1,
  MaxRequestMs: -1,
  MaxNetworkRetries: 0,
  Headers: {},
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const unlimited = await capturePayload("ClaudeMessages", -1);
  assert.equal(typeof unlimited.max_tokens, "number");

  const limited = await capturePayload("ClaudeMessages", 321);
  assert.equal(limited.max_tokens, 321);

  const responsesUnlimited = await capturePayload("Responses", -1);
  assert.equal(responsesUnlimited.max_output_tokens, undefined);

  const chatUnlimited = await capturePayload("ChatCompletions", -1);
  assert.equal(chatUnlimited.max_tokens, undefined);

  const googleUnlimited = await capturePayload("GoogleGenerateContent", -1);
  assert.equal(
    (googleUnlimited.generationConfig as Record<string, unknown> | undefined)?.maxOutputTokens,
    undefined,
  );
  assert.ok(
    Array.isArray(googleUnlimited.contents) && googleUnlimited.contents.length > 0,
    "Google action planner payload must include non-empty contents.",
  );
  const googlePrompt = readGooglePlannerPrompt(googleUnlimited);
  assert.ok(googlePrompt.hasTimelineTurn);
  assert.equal(googlePrompt.directive.stage, "buildTaskFrame");
  assert.doesNotMatch(JSON.stringify(googleUnlimited.contents), /Timeline turn/);
  assert.doesNotMatch(JSON.stringify(googleUnlimited.contents), /Produce the ActionDecision JSON now/);

  console.log("Action planner MaxTokens verification passed.");
}

function readGooglePlannerPrompt(payload: Record<string, unknown>): {
  hasTimelineTurn: boolean;
  directive: {
    stage: string;
  };
} {
  const contents = Array.isArray(payload.contents) ? payload.contents : [];
  let hasTimelineTurn = false;
  for (const content of contents) {
    const contentRecord = content && typeof content === "object"
      ? content as Record<string, unknown>
      : {};
    const parts = Array.isArray(contentRecord.parts) ? contentRecord.parts : [];
    for (const part of parts) {
      const partRecord = part && typeof part === "object"
        ? part as Record<string, unknown>
        : {};
      const text = partRecord.text;
      if (typeof text === "string" && text.trim().startsWith("{")) {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        const context = parsed.context && typeof parsed.context === "object"
          ? parsed.context as Record<string, unknown>
          : {};
        hasTimelineTurn = Array.isArray(context.timeline) && context.timeline.length > 0;
        if ("directive" in parsed) {
          return {
            hasTimelineTurn,
            directive: parsed.directive as {
              stage: string;
            },
          };
        }
      }
    }
  }

  throw new Error("Google action planner payload did not contain planner JSON.");
}

async function capturePayload(
  endpoint: ResolvedAgentModelProviderConfig["Endpoint"],
  maxTokens: number,
): Promise<Record<string, unknown>> {
  const baseUrl = endpoint === "GoogleGenerateContent"
    ? "https://generativelanguage.googleapis.com/v1beta"
    : endpoint === "ClaudeMessages"
      ? "https://api.anthropic.com/v1"
      : "https://example.test/v1";
  const client = createActionPlannerBamlClient(
    {
      ...baseProvider,
      Endpoint: endpoint,
      BaseUrl: baseUrl,
    },
    {
      Provider: "openai-generic",
      BaseUrl: baseUrl,
      ApiKey: "test-key",
      Model: "test-model",
      Temperature: 0.1,
      MaxTokens: maxTokens,
    },
  );
  const request = await baml.request.BuildTaskFrame(
    buildActionPlannerPromptJson(createActionPlanInputFixture("test"), {
      stage: "buildTaskFrame",
    }),
    {
      clientRegistry: client.registry,
    },
  );
  return {
    ...(request.body.json() as Record<string, unknown>),
    __url: request.url,
  };
}
