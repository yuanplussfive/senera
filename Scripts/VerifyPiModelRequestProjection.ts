import assert from "node:assert/strict";
import { getCurrentSystemPrompt, normalizeContext } from "@earendil-works/pi-ai";
import { projectAgentPiModelRequestContext } from "../Source/AgentSystem/ModelEndpoints/AgentPiModelRequestProjection.js";
import { projectAgentNativeToolModel } from "../Source/AgentSystem/ModelEndpoints/AgentNativeToolModelProjector.js";
import {
  AgentNativeToolApiByEndpoint,
  AgentModelEndpointKinds,
} from "../Source/AgentSystem/ModelEndpoints/AgentModelEndpointContract.js";
import type { ResolvedAgentModelProviderConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

for (const endpoint of AgentModelEndpointKinds) {
  const provider: ResolvedAgentModelProviderConfig = {
    Id: "verify",
    ProviderId: "verify-provider",
    Kind: "OpenAICompatible",
    Endpoint: endpoint,
    BaseUrl: "https://example.invalid/v1",
    ApiKey: "test-key",
    ApiVersion: "",
    Model: "verify-model",
    ToolPlanningMode: "baml",
    ContextWindowTokens: 128_000,
    Temperature: 0,
    MaxOutputTokens: -1,
    Stream: true,
    TimeoutMs: 20_000,
    FirstTokenTimeoutMs: 20_000,
    MaxRequestMs: 20_000,
    MaxNetworkRetries: 1,
    RetryBaseDelayMs: 250,
    RetryMaxDelayMs: 10_000,
    RetryAfterMaxDelayMs: 60_000,
    Headers: {},
    Capabilities: { Vision: true, DeveloperRole: false },
  };
  const context = projectAgentPiModelRequestContext(
    {
      systemPrompt: "runtime system",
      messages: [
        { role: "developer", content: "developer rule" },
        {
          role: "user",
          content: "describe",
          attachments: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
        },
        { role: "assistant", content: "previous answer" },
      ],
    },
    provider,
  );
  assert.equal(getCurrentSystemPrompt(normalizeContext(context).messages), "runtime system\n\ndeveloper rule");
  assert.deepEqual(context.messages[0]!.content, [
    { type: "text", text: "describe" },
    { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
  ]);
  assert.equal(context.messages[1]!.role, "assistant");
  const model = projectAgentNativeToolModel(provider);
  assert.equal(model.api, AgentNativeToolApiByEndpoint[endpoint]);
  assert.equal(model.provider, provider.ProviderId);
  assert.deepEqual(model.input, ["text", "image"]);
}
console.log("Pi model request projection verification passed.");
