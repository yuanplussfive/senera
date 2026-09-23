import { describe, expect, test } from "vitest";
import { AgentMcpBundleDescriptorAdapter } from "../../../Source/AgentSystem/McpPackages/AgentMcpBundleDescriptorAdapter.js";
import { projectAgentMcpPackageTools } from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageToolProjector.js";
import { createAgentMcpPackageEndpoint } from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageRuntime.js";
import {
  AgentMcpPackageSourceKinds,
  type AgentMcpPackage,
  type AgentMcpPackageServer,
} from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageTypes.js";
import { ToolExecutionTargets } from "../../../Source/AgentSystem/Types/AgentToolContractTypes.js";
import type { AgentMcpPackageExecutionPolicy } from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageExecutionPolicy.js";
import type { AgentMcpToolDeclaration } from "../../../Source/AgentSystem/Mcp/AgentMcpToolCatalogChange.js";

function literal(value: string) {
  return { segments: [{ kind: "literal" as const, value }] };
}

const packageFixture: AgentMcpPackage = {
  rootPath: "/pkg/weather",
  configurationPath: "/pkg/weather/manifest.json",
  revision: "r1",
  name: "weather",
  source: AgentMcpPackageSourceKinds.Bundled,
  descriptorKind: "mcpb",
  servers: [],
};

function serverFixture(server: Partial<AgentMcpPackageServer> = {}): AgentMcpPackageServer {
  return {
    name: "weather",
    inputs: [],
    configuration: {
      type: "stdio",
      command: literal("node"),
      args: [],
      cwd: literal("/pkg/weather"),
    },
    ...server,
  };
}

const forecastDeclaration: AgentMcpToolDeclaration = {
  name: "forecast",
  description: "Current weather and forecast data.",
  inputSchema: { type: "object", properties: { location: { type: "string" } } },
};

const localPolicy: AgentMcpPackageExecutionPolicy = {
  targets: [ToolExecutionTargets.Local],
  preferred: ToolExecutionTargets.Local,
  preferredBackend: "local",
};

function projectTools(
  server: AgentMcpPackageServer,
  declarations: readonly AgentMcpToolDeclaration[] = [forecastDeclaration],
) {
  const endpoint = createAgentMcpPackageEndpoint(packageFixture, server);
  return projectAgentMcpPackageTools(packageFixture, server, declarations, localPolicy, endpoint);
}

describe("MCP task tool localization", () => {
  test("parses ai.senera/tool-i18n from the MCPB manifest into toolLocalization", () => {
    const context = {
      packageRoot: "/pkg/weather",
      directoryName: "weather",
      source: AgentMcpPackageSourceKinds.Bundled,
      descriptorPath: "/pkg/weather/manifest.json",
    };
    const projection = AgentMcpBundleDescriptorAdapter.project(context, {
      manifest_version: "0.3",
      name: "weather",
      version: "1.0.0",
      server: { type: "node", entry_point: "mcp/server.mjs" },
      _meta: {
        "ai.senera/execution": { targets: ["local"], preferred: "local" },
        "ai.senera/tool-i18n": {
          forecast: ["天气预报", "查询天气", "天气"],
        },
      },
    });

    expect(projection.servers[0].toolLocalization).toEqual({
      forecast: ["天气预报", "查询天气", "天气"],
    });
  });

  test("omits toolLocalization when the manifest declares none", () => {
    const context = {
      packageRoot: "/pkg/weather",
      directoryName: "weather",
      source: AgentMcpPackageSourceKinds.Bundled,
      descriptorPath: "/pkg/weather/manifest.json",
    };
    const projection = AgentMcpBundleDescriptorAdapter.project(context, {
      manifest_version: "0.3",
      name: "weather",
      version: "1.0.0",
      server: { type: "node", entry_point: "mcp/server.mjs" },
    });

    expect(projection.servers[0].toolLocalization).toBeUndefined();
  });

  test("rejects non-string aliases in tool-i18n", () => {
    const context = {
      packageRoot: "/pkg/weather",
      directoryName: "weather",
      source: AgentMcpPackageSourceKinds.Bundled,
      descriptorPath: "/pkg/weather/manifest.json",
    };
    expect(() =>
      AgentMcpBundleDescriptorAdapter.project(context, {
        manifest_version: "0.3",
        name: "weather",
        version: "1.0.0",
        server: { type: "node", entry_point: "mcp/server.mjs" },
        _meta: {
          "ai.senera/tool-i18n": { forecast: ["天气", 42] },
        },
      }),
    ).toThrow("tool-i18n aliases");
  });
});

describe("MCP task projector tool localization", () => {
  test("projects manifest tool-localization aliases onto the capability", () => {
    const tools = projectTools(serverFixture({ toolLocalization: { forecast: ["天气预报", "查询天气"] } }));

    expect(capabilityAliases(tools[0])).toEqual(["天气预报", "查询天气"]);
  });

  test("matches manifest localization keys by normalized MCP tool identity", () => {
    const tools = projectTools(serverFixture({ toolLocalization: { FORECAST: ["天气预报"] } }));

    expect(capabilityAliases(tools[0])).toEqual(["天气预报"]);
  });

  test("does not read localization metadata from the remote tool declaration", () => {
    const tools = projectTools(serverFixture(), [
      {
        ...forecastDeclaration,
        _meta: { "ai.senera/tool-i18n": ["天气预报", "查询天气"] },
      },
    ]);

    expect(tools).toHaveLength(1);
    expect(capabilityAliases(tools[0])).toEqual([]);
  });

  test("does not synthesize host aliases when the manifest declares none", () => {
    const tools = projectTools(serverFixture());

    expect(capabilityAliases(tools[0])).toEqual([]);
  });
});

function capabilityAliases(tool: { search?: { Capabilities?: Array<{ Aliases?: string[] } | undefined> } }): string[] {
  return tool.search?.Capabilities?.[0]?.Aliases ?? [];
}
