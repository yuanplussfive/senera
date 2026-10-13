import { describe, expect, test, vi } from "vitest";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { AgentMcpPackageCatalog } from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageCatalog.js";
import { createAgentMcpPackageEndpoint } from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageRuntime.js";
import { AgentMcpPackageSourceKinds } from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageTypes.js";
import {
  validateAgentMcpToolDeclarations,
  type AgentDiscoveredMcpServer,
} from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageDiscovery.js";
import type { AgentMcpToolDeclaration } from "../../../Source/AgentSystem/Mcp/AgentMcpToolCatalogChange.js";

describe("MCP package catalog", () => {
  test("preserves real declarations with an unavailable state when revalidation fails", async () => {
    const registry = new AgentExtensionRegistry();
    const catalog = new AgentMcpPackageCatalog(registry, { refresh: vi.fn() });
    const discovered = serverFixture([toolDeclaration("stable")]);
    const cached: AgentDiscoveredMcpServer = {
      ...discovered,
      endpoint: {
        id: discovered.server.name,
        revision: discovered.package_.revision,
        transport: "unresolved",
        availability: { status: "unverified" },
      },
    };
    catalog.registerPackages([cached.package_]);
    await catalog.install([cached]);
    catalog.registerDeferred([cached], {
      discover: async () => ({
        servers: [],
        deferredServers: [],
        unavailableServers: [],
        failures: [
          { packageName: cached.package_.name, serverName: cached.server.name, error: new Error("Connection refused") },
        ],
      }),
    });
    const outcome = await catalog.discoverServices([cached.server.name]);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]?.serverName).toBe(cached.server.name);
    expect(outcome.notFound).toEqual([]);
    expect(registry.getTool("mcp__catalog_fixture__stable")?.availability).toEqual({
      status: "unavailable",
      reason: "discovery_failed",
      message: "Connection refused",
    });
    expect(registry.getTool("mcp__catalog_fixture__stable")?.contract?.arguments?.jsonSchema).toMatchObject({
      type: "object",
    });
    expect(catalog.services()[0]?.availability.status).toBe("unavailable");
  });

  test("reports a declared server with no callable capabilities as not found", async () => {
    const registry = new AgentExtensionRegistry();
    const catalog = new AgentMcpPackageCatalog(registry, { refresh: vi.fn() });
    const discovered = serverFixture([]);
    catalog.registerPackages([discovered.package_]);
    catalog.registerDeferred([discovered], {
      discover: async () => ({
        servers: [discovered],
        deferredServers: [],
        unavailableServers: [],
        failures: [],
      }),
    });

    const outcome = await catalog.discoverServices([discovered.server.name]);

    expect(outcome).toEqual({
      ready: [],
      failures: [],
      unavailableServers: [],
      notFound: [discovered.server.name],
    });
  });

  test("does not turn cancellation into service failure or cancel the next discovery", async () => {
    const registry = new AgentExtensionRegistry();
    const catalog = new AgentMcpPackageCatalog(registry, { refresh: vi.fn() });
    const discovered = serverFixture([toolDeclaration("ready")]);
    catalog.registerPackages([discovered.package_]);
    const first = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let attempts = 0;
    catalog.registerDeferred([discovered], {
      discover: async (_server, signal) => {
        attempts += 1;
        if (attempts === 1) {
          started();
          await new Promise<void>((_resolve, reject) =>
            signal!.addEventListener("abort", () => reject(signal!.reason), { once: true }),
          );
        }
        return { servers: [discovered], deferredServers: [], unavailableServers: [], failures: [] };
      },
    });
    const cancelled = catalog.discoverServices([discovered.server.name], first.signal);
    const cancellation = expect(cancelled).rejects.toThrow("Cancelled discovery");
    await ready;
    const next = catalog.discoverServices([discovered.server.name]);
    first.abort(new Error("Cancelled discovery"));
    await cancellation;
    await next;
    expect(attempts).toBe(2);
    expect(catalog.services()[0]?.availability.status).toBe("ready");
  });

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

  test("persists list-change declarations and preserves the installed catalog when saving fails", async () => {
    const registry = new AgentExtensionRegistry();
    const refresh = vi.fn();
    const save = vi.fn(async () => undefined);
    const catalog = new AgentMcpPackageCatalog(registry, { refresh }, undefined, { save });
    const discovered = serverFixture([toolDeclaration("initial")]);
    await catalog.install([discovered]);
    await catalog.update({
      server: discovered.endpoint as Parameters<AgentMcpPackageCatalog["update"]>[0]["server"],
      declarations: [toolDeclaration("latest")],
    });
    expect(save).toHaveBeenCalledWith(discovered.package_, discovered.server, discovered.endpoint, [
      toolDeclaration("latest"),
    ]);
    save.mockRejectedValueOnce(new Error("Cache write failed"));
    await expect(
      catalog.update({
        server: discovered.endpoint as Parameters<AgentMcpPackageCatalog["update"]>[0]["server"],
        declarations: [toolDeclaration("unsaved")],
      }),
    ).rejects.toThrow("Cache write failed");
    expect(registry.listTools().map((tool) => tool.name)).toEqual(["mcp__catalog_fixture__latest"]);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  test("replays list changes that race cached-service revalidation", async () => {
    const registry = new AgentExtensionRegistry();
    const catalog = new AgentMcpPackageCatalog(registry, { refresh: vi.fn() });
    const discovered = serverFixture([toolDeclaration("cached")]);
    await catalog.install([discovered]);
    catalog.registerDeferred([discovered], {
      discover: async () => {
        await catalog.update({
          server: createAgentMcpPackageEndpoint(discovered.package_, discovered.server),
          declarations: [toolDeclaration("latest")],
        });
        return { servers: [discovered], deferredServers: [], unavailableServers: [], failures: [] };
      },
    });
    await catalog.discoverServices([discovered.server.name]);
    expect(registry.listTools().map((tool) => tool.name)).toEqual(["mcp__catalog_fixture__latest"]);
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

  test("accepts MCP tool declarations using JSON Schema draft 2020-12", () => {
    const discovered = serverFixture([]);
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        coordinate: {
          type: "array",
          prefixItems: [{ type: "number" }, { type: "number" }],
          minItems: 2,
          maxItems: 2,
        },
      },
      required: ["coordinate"],
      additionalProperties: false,
    };

    expect(() =>
      validateAgentMcpToolDeclarations(
        [toolDeclaration("draft-2020-12", schema)],
        discovered.package_,
        discovered.server,
      ),
    ).not.toThrow();
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
