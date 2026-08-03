import { describe, expect, test, vi } from "vitest";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { AgentMcpPackageCatalog } from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageCatalog.js";
import { createAgentMcpPackageEndpoint } from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageRuntime.js";
import { AgentMcpPackageSourceKinds } from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageTypes.js";
import type { AgentDiscoveredMcpServer } from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageDiscovery.js";
import type { AgentMcpToolDeclaration } from "../../../Source/AgentSystem/Mcp/AgentMcpToolCatalogChange.js";

describe("MCP package catalog", () => {
  test("replaces a changed server catalog and invalidates ToolSearch", async () => {
    const registry = new AgentExtensionRegistry();
    const refresh = vi.fn();
    const catalog = new AgentMcpPackageCatalog(registry, { refresh });
    const discovered = serverFixture([toolDeclaration("alpha")]);
    await catalog.install([discovered]);

    await catalog.update({
      server: createAgentMcpPackageEndpoint(discovered.package_, discovered.server),
      declarations: [toolDeclaration("beta")],
    });

    expect(registry.listTools().map((tool) => tool.name)).toEqual(["mcp__catalog_fixture__beta"]);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  test("rejects an invalid changed declaration without mutating the installed catalog", async () => {
    const registry = new AgentExtensionRegistry();
    const refresh = vi.fn();
    const catalog = new AgentMcpPackageCatalog(registry, { refresh });
    const discovered = serverFixture([toolDeclaration("stable")]);
    await catalog.install([discovered]);

    await expect(
      catalog.update({
        server: createAgentMcpPackageEndpoint(discovered.package_, discovered.server),
        declarations: [toolDeclaration("invalid", { type: "unsupported-json-schema-type" })],
      }),
    ).rejects.toThrow("invalid JSON Schema");

    expect(registry.listTools().map((tool) => tool.name)).toEqual(["mcp__catalog_fixture__stable"]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  test("replays the latest list change received during initial discovery", async () => {
    const registry = new AgentExtensionRegistry();
    const refresh = vi.fn();
    const catalog = new AgentMcpPackageCatalog(registry, { refresh });
    const discovered = serverFixture([toolDeclaration("initial")]);

    await catalog.update({
      server: createAgentMcpPackageEndpoint(discovered.package_, discovered.server),
      declarations: [toolDeclaration("latest")],
    });
    await catalog.install([discovered]);

    expect(registry.listTools().map((tool) => tool.name)).toEqual(["mcp__catalog_fixture__latest"]);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

function serverFixture(declarations: readonly AgentMcpToolDeclaration[]): AgentDiscoveredMcpServer {
  const server = {
    name: "catalog-fixture",
    configuration: {
      type: "http" as const,
      url: { segments: [{ kind: "literal" as const, value: "https://mcp.example.test" }] },
    },
    inputs: [],
  };
  const package_ = {
    rootPath: "E:/workspace/.senera/mcp/catalog-fixture",
    configurationPath: "E:/workspace/.senera/mcp/catalog-fixture/.mcp.json",
    revision: "fixture-revision",
    name: "catalog-fixture",
    source: AgentMcpPackageSourceKinds.Bundled,
    descriptorKind: "registry" as const,
    servers: [server],
  };
  return {
    package_,
    server,
    declarations,
    execution: {
      targets: ["Local"],
      preferred: "Local",
      preferredBackend: "local",
    },
    endpoint: createAgentMcpPackageEndpoint(package_, server),
  };
}

function toolDeclaration(
  name: string,
  inputSchema: Readonly<Record<string, unknown>> = { type: "object", properties: {} },
): AgentMcpToolDeclaration {
  return {
    name,
    description: `${name} tool`,
    inputSchema,
  };
}
