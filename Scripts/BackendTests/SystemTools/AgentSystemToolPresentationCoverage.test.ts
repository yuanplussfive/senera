import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { listDefaultAgentHostCapabilityNames } from "../../../Source/AgentSystem/AgentDefaultHostCapabilities.js";
import { discoverAgentSystemExtensionPackages } from "../../../Source/AgentSystem/SystemTools/AgentSystemExtensionDiscovery.js";
import { systemToolCapability } from "../../../Source/AgentSystem/SystemTools/AgentSystemToolCatalog.js";
import { AgentSystemExtensionCatalog } from "../../../Source/AgentSystem/SystemTools/AgentSystemToolSource.js";
import { createAgentSystemTools } from "../../../Source/AgentSystem/SystemTools/AgentSystemTools.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

const SystemExtensionRoot = path.resolve("System", "Extensions");

type JsonObject = Record<string, unknown>;

interface BundledHostTool {
  readonly name: string;
  readonly extension: string;
  readonly inputSchema: unknown;
  readonly activity: { readonly argumentPath?: string; readonly detailPaths?: readonly string[] } | undefined;
  readonly registered: boolean;
}

/**
 * The workflow feed renders `activity.argumentPath` and `activity.detailPaths`
 * instead of dumping raw arguments, so a declaration that never resolves
 * silently degrades every tool call of that tool into `key=value` noise. This
 * gate keeps the published declarations and the published input schemas
 * honest against each other.
 */
describe("System Tool activity presentation coverage", () => {
  test("every bundled host tool declares an activity preview that resolves against its input schema", () => {
    const tools = readBundledHostTools();
    expect(tools.length).toBeGreaterThan(60);

    const failures = tools.flatMap(describePresentationFailures);
    expect(failures).toEqual([]);
  });

  test("scans the same host tools the System extension catalog registers", () => {
    const tools = readBundledHostTools();
    expect(tools.filter((tool) => !tool.registered).map((tool) => tool.name)).toEqual([]);
  });

  test("keeps sidecar Tools out of the workflow activity contract", () => {
    const sidecarNames = discoverAgentSystemExtensionPackages(SystemExtensionRoot).flatMap((source) =>
      (source.manifest.contributions ?? [])
        .filter((contribution) => contribution.kind === "sidecarTool")
        .map((contribution) => path.basename(contribution.contract, ".tool.json")),
    );

    expect(sidecarNames.length).toBeGreaterThan(0);
    const activityTools = new Set(readBundledHostTools().map((tool) => tool.name));
    expect(sidecarNames.filter((name) => activityTools.has(name))).toEqual([]);
  });
});

function describePresentationFailures(tool: BundledHostTool): string[] {
  if (!tool.registered) return [];
  const pointers = [tool.activity?.argumentPath, ...(tool.activity?.detailPaths ?? [])].filter(
    (pointer): pointer is string => Boolean(pointer),
  );
  if (pointers.length === 0) {
    return hasTextLeaf(tool.inputSchema)
      ? [`${tool.name} (${tool.extension}): accepts text arguments but declares no argumentPath/detailPaths`]
      : [];
  }
  return pointers.flatMap((pointer) => {
    const leaves = resolvePointer(tool.inputSchema, pointer);
    if (leaves.length === 0) {
      return [`${tool.name} (${tool.extension}): ${pointer} does not resolve against the input schema`];
    }
    if (!leaves.some(isTextLeaf)) {
      return [`${tool.name} (${tool.extension}): ${pointer} never resolves to a text argument`];
    }
    return [];
  });
}

function readBundledHostTools(): readonly BundledHostTool[] {
  const registry = systemToolRegistry();
  const registered = new Map(registry.listTools().map((tool) => [tool.name, tool.presentation]));
  const tools: BundledHostTool[] = [];
  for (const source of discoverAgentSystemExtensionPackages(SystemExtensionRoot)) {
    for (const contribution of source.manifest.contributions ?? []) {
      if (contribution.kind !== "hostTool") continue;
      const contract = JSON.parse(readFileSync(path.join(source.packageRoot, contribution.contract), "utf8"));
      tools.push({
        name: contract.name,
        extension: source.manifest.id,
        inputSchema: contract.inputSchema,
        activity: registered.get(contract.name)?.activity,
        registered: registered.has(contract.name),
      });
    }
  }
  return tools;
}

function systemToolRegistry(): AgentExtensionRegistry {
  const registry = new AgentExtensionRegistry();
  const definitions = createAgentSystemTools(testConfig());
  new AgentSystemExtensionCatalog().registerRoot(registry, SystemExtensionRoot, {
    capabilities: new Set([...listDefaultAgentHostCapabilityNames(), ...definitions.map(systemToolCapability)]),
  });
  return registry;
}

function testConfig(): AgentSystemConfig {
  return {
    DefaultModelProviderId: "test-model",
    ModelProviderEndpoints: [{ Id: "openai", Enabled: true, BaseUrl: "https://example.test/v1" }],
    ModelProviders: [
      {
        Id: "test-model",
        ProviderId: "openai",
        Endpoint: "ChatCompletions",
        Model: "test-model",
        Capabilities: { Vision: true },
      },
    ],
  };
}

/** Resolves an RFC 6901 pointer pattern, expanding combinators and `*` over array items and open object values. */
function resolvePointer(schema: unknown, pointer: string): readonly JsonObject[] {
  const visit = (node: unknown, tokens: readonly string[]): readonly JsonObject[] => {
    if (!isJsonObject(node)) return [];
    return [...visitLocal(node, tokens), ...combinatorBranches(node).flatMap((branch) => visit(branch, tokens))];
  };
  const visitLocal = (node: JsonObject, tokens: readonly string[]): readonly JsonObject[] => {
    if (tokens.length === 0) return [node];
    const [token, ...tail] = tokens;
    if (token === "*") {
      const children = [node.items, isJsonObject(node.additionalProperties) ? node.additionalProperties : undefined];
      return children.flatMap((child) => visit(child, tail));
    }
    return visit(isJsonObject(node.properties) ? node.properties[token] : undefined, tail);
  };
  return visit(schema, pointerTokens(pointer));
}

function hasTextLeaf(schema: unknown): boolean {
  const seen = new Set<unknown>();
  const visit = (node: unknown): boolean => {
    if (!isJsonObject(node) || seen.has(node)) return false;
    seen.add(node);
    if (isTextLeaf(node)) return true;
    const children: unknown[] = [
      ...combinatorBranches(node),
      ...(isJsonObject(node.properties) ? Object.values(node.properties) : []),
      node.items,
      isJsonObject(node.additionalProperties) ? node.additionalProperties : undefined,
    ];
    return children.some(visit);
  };
  return visit(schema);
}

function combinatorBranches(node: JsonObject): readonly unknown[] {
  return ["anyOf", "oneOf", "allOf"].flatMap((key) => (Array.isArray(node[key]) ? (node[key] as unknown[]) : []));
}

function isTextLeaf(node: JsonObject): boolean {
  if (node.type === "string") return true;
  return Array.isArray(node.enum) && node.enum.length > 0 && node.enum.every((entry) => typeof entry === "string");
}

function pointerTokens(pointer: string): readonly string[] {
  return pointer === "" || pointer === "/"
    ? []
    : pointer
        .slice(1)
        .split("/")
        .map((token) => token.replace(/~1/gu, "/").replace(/~0/gu, "~"));
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
