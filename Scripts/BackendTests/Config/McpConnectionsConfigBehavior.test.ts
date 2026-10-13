import { describe, expect, test } from "vitest";
import { resolveAgentMcpConnectionsConfig } from "../../../Source/AgentSystem/AgentDefaults.js";
import { CurrentAgentConfigVersion } from "../../../Source/AgentSystem/Config/AgentConfigVersion.js";
import { AgentSystemConfigSchema } from "../../../Source/AgentSystem/Schemas/AgentSystemConfigSchema.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("MCP connection lifecycle configuration", () => {
  test("accepts connection policy at both inheritance layers", () => {
    const result = AgentSystemConfigSchema.safeParse({
      ConfigVersion: CurrentAgentConfigVersion,
      Defaults: { McpConnections: { IdleTtlSeconds: 120, SweepIntervalSeconds: 10 } },
      McpConnections: { IdleTtlSeconds: 30 },
      ModelProviders: [{ Id: "main", ProviderId: "main", Endpoint: "ChatCompletions", Model: "test" }],
    });

    expect(result.success).toBe(true);
  });

  test("rejects negative idle TTL and a non-positive sweep interval", () => {
    const result = AgentSystemConfigSchema.safeParse({
      ConfigVersion: CurrentAgentConfigVersion,
      McpConnections: { IdleTtlSeconds: -1, SweepIntervalSeconds: 0 },
      ModelProviders: [{ Id: "main", ProviderId: "main", Endpoint: "ChatCompletions", Model: "test" }],
    });

    expect(result.success).toBe(false);
  });

  test("resolves root overrides before inherited values and execution defaults", () => {
    const config = {
      Defaults: {
        McpConnections: { IdleTtlSeconds: 120, SweepIntervalSeconds: 10 },
        ToolExecution: { Resources: { IdleTtlSeconds: 900, SweepIntervalSeconds: 40 } },
      },
      McpConnections: { IdleTtlSeconds: 30 },
      ModelProviders: [],
    } as AgentSystemConfig;

    expect(resolveAgentMcpConnectionsConfig(config)).toEqual({ IdleTtlMs: 30_000, SweepIntervalMs: 10_000 });
  });
});
