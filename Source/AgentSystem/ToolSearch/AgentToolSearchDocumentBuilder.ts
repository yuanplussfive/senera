import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import { resolveAgentToolOwner } from "../Types/AgentToolOwner.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { ToolSearchDocument } from "./AgentToolSearchTypes.js";
import { capabilityFacetEntries, capabilityRiskText, capabilitySearchText } from "./AgentToolSearchCapabilities.js";

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
  build(tool: RegisteredTool): ToolSearchDocument {
    const owner = resolveAgentToolOwner(tool);
    const search = tool.search;
    const sources = tool.sources.map((source) => ({
      id: source.Id,
      title: source.Title,
      description: source.Description,
    }));
    const sourceIds = sources.map((source) => source.id);
    const sourceText = sources.map((source) => `${source.id} ${source.title} ${source.description}`).join(" ");
    const title = owner.title ?? tool.name;
    const summary = search?.Summary ?? owner.description ?? "";
    const whenToUse = (search?.UseCases ?? []).join(" ");
    const examples = (search?.Examples ?? []).join(" ");
    const avoid = (search?.Avoid ?? []).join(" ");
    const tags = (search?.Tags ?? []).join(" ");
    const capabilities = search?.Capabilities ?? [];
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
    const params = this.readSignatureParams(tool);
    const permissions = tool.permissions.join(" ");
    const coreText = [
      tool.name,
      title,
      owner.name,
      owner.title,
      sourceText,
      tags,
      summary,
      whenToUse,
      examples,
      capabilityText,
      capabilityFacets,
      params,
      permissions,
    ]
      .filter(Boolean)
      .join(" ");

    return {
      id: stableToolDocumentId(tool),
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
      avoid,
      capabilityText,
      capabilityFacets,
      capabilityRiskText: capabilityRiskDocumentText,
      params,
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
