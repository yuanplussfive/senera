import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import { resolveAgentToolOwner } from "../Types/AgentToolOwner.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentToolSearchSource, ToolSearchDocument } from "./AgentToolSearchTypes.js";
import { capabilityFacetEntries, capabilityRiskText, capabilitySearchText } from "./AgentToolSearchCapabilities.js";
import type { AgentToolResourceDiscoveryReader } from "../ToolRuntime/AgentToolResourceDiscovery.js";

export const ToolSearchDocumentSearchFields = [
  "toolName",
  "title",
  "ownerName",
  "ownerTitle",
  "sourceText",
  "tags",
  "summary",
  "whenToUse",
  "examples",
  "capabilityText",
  "capabilityFacets",
  "capabilityRiskText",
  "params",
  "permissions",
  "anchorText",
] satisfies Array<keyof ToolSearchDocument>;

export const ToolSearchDocumentStoreFields = [
  "toolName",
  "title",
  "ownerName",
  "summary",
  "whenToUse",
  "permissions",
] satisfies Array<keyof ToolSearchDocument>;

export class AgentToolSearchDocumentBuilder {
  constructor(private readonly resourceDiscovery?: AgentToolResourceDiscoveryReader) {}

  build(tool: RegisteredTool): ToolSearchDocument {
    const owner = resolveAgentToolOwner(tool);
    const search = tool.search;
    const sources = resolveAgentToolSearchSources(tool);
    const sourceIds = sources.map((source) => source.id);
    const sourceText = sources.map((source) => `${source.id} ${source.title} ${source.description}`).join(" ");
    // An extension owner is a package-level concept: every browser action, for
    // example, shares the same owner title. Tool routing needs an operation
    // identity instead, otherwise that shared package label becomes accidental
    // lexical evidence for every sibling. A capability title is authored for
    // precisely this tool; tool.name remains the stable display identity when
    // a tool has multiple capability labels.
    const title = resolveAgentToolSearchTitle(tool);
    const summary = resolveAgentToolSearchDescription(tool);
    const whenToUse = (search?.UseCases ?? []).join(" ");
    const examplePhrases = (search?.Examples ?? []).map((example) => example.trim()).filter(Boolean);
    const examples = examplePhrases.join(" ");
    const avoid = (search?.Avoid ?? []).join(" ");
    const tags = (search?.Tags ?? []).join(" ");
    const capabilities = search?.Capabilities ?? [];
    const formalIdentityPhrases = uniqueSearchPhrases([tool.name, ...capabilities.map((capability) => capability.Id)]);
    const identityPhrases = uniqueSearchPhrases([
      ...formalIdentityPhrases,
      title,
      ...capabilities.flatMap((capability) => [capability.Title, ...(capability.Aliases ?? [])]),
    ]);
    const capabilityText = capabilities
      .map((capability) =>
        capabilitySearchText(capability, {
          includeRisk: false,
        }),
      )
      .join(" ");
    const capabilityFacets = capabilities
      .flatMap((capability) => capabilityFacetEntries(capability.Facets).flatMap((entry) => entry.values))
      .join(" ");
    const capabilityRiskDocumentText = capabilities.map((capability) => capabilityRiskText(capability.Risk)).join(" ");
    const resources = tool.handler.resources ?? [];
    const resourceQueryShapes = [
      ...new Set(
        resources.flatMap((resource) => this.resourceDiscovery?.getDiscovery(resource.Capability)?.queryShapes ?? []),
      ),
    ];
    const params = [
      this.readSignatureParams(tool),
      ...resources.flatMap((resource) => [
        resource.Capability,
        resource.Pointer,
        resource.Binding,
        ...Object.entries(resource.Parameters ?? {}).flatMap(([name, value]) => [
          name,
          ...flattenStructuredValue(value),
        ]),
      ]),
    ]
      .filter(Boolean)
      .join(" ");
    const permissions = tool.permissions.join(" ");
    // Core lexical recall uses intentional capability language. Parameter
    // help remains available to contract projection and semantic matching,
    // but incidental prose must not create a false retrieval hit.
    const anchorText = [tool.name, title, tags, summary, capabilityText, capabilityFacets].filter(Boolean).join(" ");
    const coreText = [anchorText, whenToUse].filter(Boolean).join(" ");

    return {
      id: stableToolDocumentId(tool),
      anchorText,
      toolName: tool.name,
      title,
      ownerName: owner.name,
      ownerTitle: owner.title ?? "",
      sourceText,
      sourceIds,
      sources,
      tags,
      summary,
      whenToUse,
      examples,
      examplePhrases,
      avoid,
      capabilityText,
      capabilityFacets,
      capabilityRiskText: capabilityRiskDocumentText,
      params,
      identityPhrases,
      formalIdentityPhrases,
      resourceQueryShapes,
      permissions,
      capabilities,
      priority: owner.priority ?? 100,
      coreText,
    };
  }

  private readSignatureParams(tool: RegisteredTool): string {
    const fields = tool.contract?.arguments?.properties.flatMap(readContractPropertyTokens) ?? [];
    return fields.map((field) => [field.name, field.typeText, field.comment].filter(Boolean).join(" ")).join(" ");
  }
}

/**
 * Resolves the source projection used by discovery, reuse, and compact result
 * disclosure. Standard MCP only supplies tool metadata, so an empty explicit
 * source list is completed from the registration provenance already owned by
 * the host. No server- or tool-name mapping is involved.
 */
export function resolveAgentToolSearchSources(
  tool: Pick<RegisteredTool, "owner" | "handler" | "sources">,
): AgentToolSearchSource[] {
  const declared = tool.sources.map((source) => ({
    id: source.Id,
    title: source.Title,
    description: source.Description,
  }));
  return declared.length > 0 ? declared : [deriveAgentToolSearchSource(tool)];
}

function deriveAgentToolSearchSource(tool: Pick<RegisteredTool, "owner" | "handler">): AgentToolSearchSource {
  const ownerName = requiredSourceText(tool.owner.name, "owner.name");
  const ownerTitle = optionalSourceText(tool.owner.title);
  const ownerDescription = optionalSourceText(tool.owner.description);
  if (tool.handler.kind === "McpTool") {
    const packageName = optionalSourceText(tool.handler.server.packageName);
    const sourceName = [packageName, ownerName].filter((value): value is string => Boolean(value)).join("/");
    return {
      id: `mcp:${sourceName}`,
      title: sourceName,
      description: ownerDescription ?? sourceName,
    };
  }

  const sourceName = ownerTitle ?? ownerName;
  return {
    id: `${tool.owner.kind}:${ownerName}`,
    title: sourceName,
    description: ownerDescription ?? sourceName,
  };
}

function requiredSourceText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Tool discovery source requires ${field}.`);
  return normalized;
}

function optionalSourceText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

/**
 * Produces the operation-level label used by local ranking and diagnostic
 * surfaces. Extension owners remain available independently as owner metadata
 * and must not stand in for a tool identity. Model-facing discovery uses the
 * separately declared description below.
 */
export function resolveAgentToolSearchTitle(tool: Pick<RegisteredTool, "name" | "search">): string {
  const capabilityTitles = [
    ...new Set(
      (tool.search?.Capabilities ?? [])
        .map((capability) => capability.Title?.trim())
        .filter((title): title is string => Boolean(title)),
    ),
  ];
  return capabilityTitles.length === 1 ? capabilityTitles[0]! : tool.name;
}

/**
 * Resolves the producer-authored explanation exposed to the model after a
 * search. A tool name and presentation title are identifiers, not a semantic
 * fallback: allowing either here hides incomplete tool declarations and makes
 * a retrieval card much harder for a model to act on correctly.
 */
export function resolveAgentToolSearchDescription(tool: Pick<RegisteredTool, "name" | "search">): string {
  const summary = tool.search?.Summary?.trim();
  if (summary) return summary;

  const capabilityDescriptions = uniqueSearchPhrases(
    (tool.search?.Capabilities ?? []).map((capability) => capability.Description),
  );
  if (capabilityDescriptions.length > 0) return capabilityDescriptions.join(" ");

  throw new Error(
    `Tool ${tool.name} must declare search.Summary or at least one search capability Description for ToolSearch.`,
  );
}

function uniqueSearchPhrases(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function readContractPropertyTokens(
  property: import("../Prompt/AgentPromptContractTypes.js").AgentPromptContractProperty,
): Array<{ name: string; typeText: string; comment: string }> {
  return [
    {
      name: property.name,
      typeText: property.typeText,
      comment: property.comment,
    },
    ...property.children.flatMap(readContractPropertyTokens),
    ...(property.element ? readContractPropertyTokens(property.element) : []),
  ];
}

function stableToolDocumentId(tool: RegisteredTool): string {
  return sha256HexOfCanonicalJson([resolveAgentToolOwner(tool).name, tool.name]);
}

function flattenStructuredValue(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(flattenStructuredValue);
  if (typeof value === "object") {
    return Object.entries(value).flatMap(([name, nested]) => [name, ...flattenStructuredValue(nested)]);
  }
  return [];
}
