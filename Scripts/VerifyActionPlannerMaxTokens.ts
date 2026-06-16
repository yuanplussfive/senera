import assert from "node:assert/strict";
import { AgentActionPlannerModelClient } from "../Source/AgentSystem/AgentActionPlannerModelClient.js";
import type { ResolvedAgentModelProviderConfig } from "../Source/AgentSystem/Types.js";
import {
  createActionPlanInputFixture,
} from "./ActionPlannerFixture.js";

const baseProvider: ResolvedAgentModelProviderConfig = {
  Id: "test",
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

const actionSelection = JSON.stringify({
  action: "Answer",
});

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const unlimited = await capturePayload("ClaudeMessages", -1);
  assert.equal(unlimited.max_tokens, undefined);
  assert.equal(unlimited.stream, true);

  const limited = await capturePayload("ClaudeMessages", 321);
  assert.equal(limited.max_tokens, 321);

  const responsesUnlimited = await capturePayload("Responses", -1);
  assert.equal(responsesUnlimited.max_output_tokens, undefined);
  assert.equal(responsesUnlimited.stream, true);

  const chatUnlimited = await capturePayload("ChatCompletions", -1);
  assert.equal(chatUnlimited.max_tokens, undefined);
  assert.equal(chatUnlimited.stream, true);

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
  assert.ok("context" in googlePrompt);
  assert.ok("timeline" in googlePrompt.context);
  assert.ok("directive" in googlePrompt);
  assert.equal(googlePrompt.directive.stage, "selectAction");
  assert.doesNotMatch(JSON.stringify(googleUnlimited.contents), /Timeline turn/);
  assert.doesNotMatch(JSON.stringify(googleUnlimited.contents), /Produce the ActionDecision JSON now/);
  assert.match(String(googleUnlimited.__url), /alt=sse/);

  console.log("Action planner MaxTokens verification passed.");
}

function readGooglePlannerPrompt(payload: Record<string, unknown>): {
  context: {
    timeline: unknown[];
  };
  directive: {
    stage: string;
  };
} {
  const contents = Array.isArray(payload.contents) ? payload.contents : [];
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
        return JSON.parse(text) as {
          context: {
            timeline: unknown[];
          };
          directive: {
            stage: string;
          };
        };
      }
    }
  }

  throw new Error("Google action planner payload did not contain planner JSON.");
}

async function capturePayload(
  endpoint: ResolvedAgentModelProviderConfig["Endpoint"],
  maxTokens: number,
): Promise<Record<string, unknown>> {
  const originalFetch = globalThis.fetch;
  let payload: Record<string, unknown> | undefined;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    payload.__url = String(input);
    return new Response(responseBody(endpoint), {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
      },
    });
  };

  try {
    const client = new AgentActionPlannerModelClient(
      {
        ...baseProvider,
        Endpoint: endpoint,
        BaseUrl: endpoint === "GoogleGenerateContent"
          ? "https://generativelanguage.googleapis.com/v1beta"
          : endpoint === "ClaudeMessages"
            ? "https://api.anthropic.com/v1"
            : "https://example.test/v1",
      },
      {
        Provider: "auto",
        Temperature: 0.1,
        MaxTokens: maxTokens,
      },
    );
    await client.selectAction(createActionPlanInputFixture("test"));
    assert.ok(payload);
    return payload;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function responseBody(endpoint: ResolvedAgentModelProviderConfig["Endpoint"]): string {
  const responseByEndpoint = {
    Responses: sseEvent({
      type: "response.output_text.delta",
      delta: actionSelection,
    }),
    ChatCompletions: sseEvent({
      choices: [{
        delta: {
          content: actionSelection,
        },
      }],
    }),
    ClaudeMessages: sseEvent({
      type: "content_block_delta",
      delta: {
        text: actionSelection,
      },
    }),
    GoogleGenerateContent: sseEvent({
      candidates: [{
        content: {
          parts: [{ text: actionSelection }],
        },
      }],
    }),
  } satisfies Record<ResolvedAgentModelProviderConfig["Endpoint"], string>;

  return responseByEndpoint[endpoint];
}

function sseEvent(value: Record<string, unknown>): string {
  return [
    `data: ${JSON.stringify(value)}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
}
