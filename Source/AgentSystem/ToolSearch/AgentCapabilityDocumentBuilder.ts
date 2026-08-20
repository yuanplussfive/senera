import type { RegisteredSkill } from "../Skills/AgentSkillTypes.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import { resolveAgentToolOwner } from "../Types/AgentToolOwner.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { capabilityFacetEntries, capabilitySearchText } from "./AgentToolSearchCapabilities.js";
import type { ToolSearchDocument } from "./AgentToolSearchTypes.js";
import { AgentCapabilityKinds, type AgentCapabilitySearchDocument } from "./AgentCapabilitySearchIndex.js";

export function buildToolCapabilityDocument(
  tool: RegisteredTool,
  document: ToolSearchDocument,
): AgentCapabilitySearchDocument {
  const owner = resolveAgentToolOwner(tool);
  return {
    id: capabilityDocumentId(AgentCapabilityKinds.Tool, owner.name, tool.name),
    kind: AgentCapabilityKinds.Tool,
    name: tool.name,
    revision: tool.contract?.digest ?? owner.revision,
    title: document.title,
    owner: `${document.ownerName} ${document.ownerTitle}`,
    sourceText: document.sourceText,
    tags: document.tags,
    summary: document.summary,
    useCases: document.whenToUse,
    examples: document.examples,
    capabilityText: document.capabilityText,
    capabilityFacets: document.capabilityFacets,
    parameters: document.params,
    semanticText: semanticCapabilityText({
      title: document.title,
      summary: document.summary,
      useCases: document.whenToUse,
      examples: document.examples,
      capabilities: document.capabilityText,
      parameters: document.params,
      owner: document.ownerTitle || document.ownerName,
    }),
  };
}

export function buildSkillCapabilityDocument(skill: RegisteredSkill): AgentCapabilitySearchDocument {
  const search = skill.search;
  const capabilities = search?.Capabilities ?? [];
  const capabilityText = capabilities
    .map((capability) => capabilitySearchText(capability, { includeRisk: false }))
    .join(" ");
  const capabilityFacets = capabilities
    .flatMap((capability) => capabilityFacetEntries(capability.Facets).flatMap((entry) => entry.values))
    .join(" ");
  const tags = (search?.Tags ?? []).join(" ");
  const summary = search?.Summary ?? skill.description;
  const useCases = (search?.UseCases ?? []).join(" ");
  const examples = (search?.Examples ?? []).join(" ");
  const title = skill.title ?? search?.Summary ?? skill.name;
  const parameters = skill.recommendedTools.join(" ");
  return {
    id: capabilityDocumentId(AgentCapabilityKinds.Skill, skill.source.id, skill.name),
    kind: AgentCapabilityKinds.Skill,
    name: skill.name,
    revision: skill.revision ?? skill.source.id,
    title,
    owner: skill.source.displayName,
    sourceText: `${skill.source.kind} ${skill.source.id} ${skill.source.displayName}`,
    tags,
    summary,
    useCases,
    examples,
    capabilityText,
    capabilityFacets,
    parameters,
    semanticText: semanticCapabilityText({
      title,
      summary,
      useCases,
      examples,
      capabilities: capabilityText,
      parameters,
      owner: skill.source.displayName,
    }),
  };
}

function semanticCapabilityText(fields: Readonly<Record<string, string>>): string {
  return Object.entries(fields)
    .filter(([, value]) => value.trim().length > 0)
    .map(([name, value]) => `${name}: ${value.trim()}`)
    .join("\n");
}

function capabilityDocumentId(kind: string, owner: string, name: string): string {
  return sha256HexOfCanonicalJson([kind, owner, name]);
}
