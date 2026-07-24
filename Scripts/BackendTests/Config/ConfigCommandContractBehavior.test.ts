import { describe, expect, it } from "vitest";
import { AgentProviderEndpointPatchSchema } from "../../../Source/AgentSystem/Config/AgentConfigCommandSchemas.js";
import runtimeContract from "../../../Source/AgentSystem/Config/CommandContracts/runtime.json" with { type: "json" };
import { loadAgentConfigCommandRuntimeContract } from "../../../Source/AgentSystem/Config/AgentConfigCommandContract.js";
import { AgentWebSocketRequestSchema } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketProtocol.js";

describe("configuration command contracts", () => {
  it("loads the generated versioned runtime contract", () => {
    expect(loadAgentConfigCommandRuntimeContract(runtimeContract)).toMatchObject({
      id: "agent-config-commands",
      version: 1,
      definition: {
        operations: {
          "provider.endpoint.upsert": {
            semantics: "json-merge-patch",
            identityFields: ["Id"],
          },
        },
      },
    });
  });

  it("derives merge patch deletion semantics from the endpoint schema", () => {
    expect(
      AgentProviderEndpointPatchSchema.parse({
        Id: "custom",
        ApiKey: null,
        Headers: null,
      }),
    ).toEqual({ Id: "custom", ApiKey: null, Headers: null });
    expect(AgentProviderEndpointPatchSchema.safeParse({ Id: null }).success).toBe(false);
    expect(AgentProviderEndpointPatchSchema.safeParse({ Id: "custom", unknown: true }).success).toBe(false);
  });

  it("uses the generated patch contract at the WebSocket boundary", () => {
    expect(
      AgentWebSocketRequestSchema.safeParse({
        type: "provider.endpoint.upsert",
        commandId: "command-1",
        endpoint: { Id: "custom", ApiKey: null },
      }).success,
    ).toBe(true);
    expect(
      AgentWebSocketRequestSchema.safeParse({
        type: "provider.endpoint.upsert",
        commandId: "command-1",
        endpoint: { Id: null },
      }).success,
    ).toBe(false);
  });
});
