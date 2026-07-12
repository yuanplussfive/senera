import fs from "node:fs";
import crypto from "node:crypto";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import { AgentPromptContractProjector } from "../Prompt/AgentPromptContractProjector.js";
import type { ToolSearchDocument } from "./AgentToolSearchTypes.js";
import { capabilityFacetEntries, capabilityRiskText, capabilitySearchText } from "./AgentToolSearchCapabilities.js";

export const ToolSearchDocumentSearchFields = [
  "toolName",
  "title",
  "pluginName",
  "pluginTitle",
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
  "pluginName",
  "summary",
  "whenToUse",
  "permissions",
] satisfies Array<keyof ToolSearchDocument>;

export class AgentToolSearchDocumentBuilder {
  private readonly contractProjector = new AgentPromptContractProjector();

  build(tool: RegisteredTool): ToolSearchDocument {
    const search = tool.search;
    const title = tool.plugin.manifest.Plugin.Title ?? tool.name;
    const summary = search?.Summary ?? tool.plugin.manifest.Plugin.Description ?? "";
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
      tool.plugin.manifest.Plugin.Name,
      tool.plugin.manifest.Plugin.Title,
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
      pluginName: tool.plugin.manifest.Plugin.Name,
      pluginTitle: tool.plugin.manifest.Plugin.Title ?? "",
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
      priority: tool.plugin.manifest.Prompting?.Priority ?? 100,
      coreText,
    };
  }

  private readSignatureParams(tool: RegisteredTool): string {
    if (!tool.signatureFile || !fs.existsSync(tool.signatureFile)) {
      return "";
    }

    try {
      const contract = this.contractProjector.projectFromFile(tool.signatureFile, "arguments", tool.signatureType);
      const fields = contract?.properties.flatMap(readContractPropertyTokens) ?? [];
      return fields.map((field) => field.name).join(" ");
    } catch {
      return "";
    }
  }
}

function readContractPropertyTokens(
  property: import("../Prompt/AgentPromptContractProjector.js").AgentPromptContractProperty,
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
  return crypto.createHash("sha1").update(`${tool.plugin.manifest.Plugin.Name}:${tool.name}`).digest("hex");
}
